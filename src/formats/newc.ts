import type { Readable } from "stream";
import type { Entry } from "../common";
import { sizeof, char } from "structured-buffer";
import { parse } from "structured-buffer";
import { readStreamAsync, parsePermissions, parseType } from "../common";
import { createReadStream, readFileSync } from "fs";

export const MAGIC = "070701";
export const CpioStruct = {
    /*
    char    c_magic[6];
    char    c_ino[8];
    char    c_mode[8];
    char    c_uid[8];
    char    c_gid[8];
    char    c_nlink[8];
    char    c_mtime[8];
    char    c_filesize[8];
    char    c_devmajor[8];
    char    c_devminor[8];
    char    c_rdevmajor[8];
    char    c_rdevminor[8];
    char    c_namesize[8];
    char    c_check[8];
    */
    c_magic: char(6),
    c_ino: char(8),
    c_mode: char(8),
    c_uid: char(8),
    c_gid: char(8),
    c_nlink: char(8),
    c_mtime: char(8),
    c_filesize: char(8),
    c_devmajor: char(8),
    c_devminor: char(8),
    c_rdevmajor: char(8),
    c_rdevminor: char(8),
    c_namesize: char(8),
    c_check: char(8),
};
export const CPIO_STRUCT_SIZE = sizeof(CpioStruct);

export function* parseCPIO(input: Buffer, blockSize: number){
    let readedBlocks = 0; // ~= Math.ceil(input.byteLength / blockSize)
    let currentBlock = 0; // ~= Math.floor(input.byteLength / blockSize)
    let offset = 0; // less than blockSize
    // read n bytes from input
    function read(bytes: number){
        if(readedBlocks === 0)
            readedBlocks++;
        if(bytes === 0)
            return input.subarray(0,0);
        if(offset + bytes > blockSize){
            const remaining = blockSize - offset; // how many bytes we need to get to the end of a imaginary buffer of blockSize byte length
            bytes -= remaining;
            const start = currentBlock * blockSize + offset; // after "reading" all the buffer, we start copying at 'start' and go all to the way to the 'end'
            //let end = currentBlock * blockSize + offset + remaining;
            let end = (currentBlock + 1) * blockSize; // currentBlock * blockSize + offset + blockSize - offset = currentBlock * blockSize + blockSize = (currentBlock +1 ) * blockSize
            offset = 0;
            while(bytes > 0){
                let min = Math.min(blockSize, bytes);
                end += min;
                offset = min % blockSize; // I think offset = blockSize - min would work, if someone knows why this work, please tell me.
                bytes -= blockSize;
                readedBlocks++; // read another block
                currentBlock++;
            }
            return input.subarray(start, end);
        }
        let start = currentBlock * blockSize + offset;
        let end = currentBlock * blockSize + offset + bytes;
        offset += bytes;
        return input.subarray(start, end);
    }
    while(true){
        const parsed = parse(CpioStruct, read(CPIO_STRUCT_SIZE)) as any;
        if(parsed.c_magic !== MAGIC){
            throw new Error("Invalid magic number");
        }
        const namesize = parseInt(parsed.c_namesize, 16);
        const filesize = parseInt(parsed.c_filesize, 16);
        const name = (read(namesize)).toString("ascii").slice(0,-1);
        // i've seen this implementation (link down below) on cpio to know how tf does that work
        // my main problem is that I thinked cpio would'nt care about the modulo being zero
        // also i tried 4 - (filesize % 4) but it didn't worked, now i know that
        // credits to finnp: https://github.com/finnp/cpio-stream/blob/cce4c9f743c9bf35a8bc09026c252b697d8431bf/lib/newc.js#L49
        read(4 - (((CPIO_STRUCT_SIZE + namesize) % 4) || 4));
        const content = read(filesize);
        read(4 - ((filesize % 4) || 4));
        if(name === "TRAILER!!!"){
            break;
        }
        const modeNum = parseInt(parsed.c_mode, 16);
        const type = parseType(modeNum);
        const entry: Entry = {
            name,
            modificationTime: new Date(parseInt(parsed.c_mtime, 16) * 1000),
            device: (BigInt(parseInt(parsed.c_devmajor, 16)) << 32n) | BigInt(parseInt(parsed.c_devminor, 16)),
            inode: parseInt(parsed.c_ino, 16),
            ownerUID: parseInt(parsed.c_uid, 16),
            ownerGID: parseInt(parsed.c_gid, 16),
            size: filesize,
            mode: {
                suid: Boolean(modeNum & 0o0004000),
                sgid: Boolean(modeNum & 0o0002000),
                sticky: Boolean(modeNum & 0o0001000),
                type,
                permission: parsePermissions(modeNum & 0o0000777)
            },
            content: type === "directory" ? null : // ternary operator madness 😢
                        (type === "blockDev" || type === "charDev") ?
                            { major: parseInt(parsed.c_rdevmajor, 16), minor: parseInt(parsed.c_rdevminor, 16) } 
                            : content,
        };
        yield entry;
    }
    return readedBlocks;
}

export async function* parseCPIOStream(input: Readable, blockSize: number){
    let nextBlock = 0; // ~= Math.ceil(input.byteLength / blockSize)
    let offset = 0; // less than blockSize
    let curBlock: Buffer;
    async function readBlock(){
        nextBlock++;
        curBlock = await readStreamAsync(input, blockSize);
        return curBlock;
    }
    async function read(bytes: number){
        if(bytes <= 0)
            return Buffer.of();
        if(nextBlock === 0)
            await readBlock();
        const buffer = Buffer.alloc(bytes);
        if(offset + bytes > blockSize){
            const remaining = blockSize - offset; // how many bytes we need to get to the end of a imaginary buffer of blockSize byte length
            let buffOffset = remaining; // you can imagine remaining as being how many bytes did curBlock copied to buffer given a offset
            curBlock.copy(buffer, 0, offset);
            bytes -= remaining;
            offset = 0;
            while(bytes > 0){
                let min = Math.min(bytes, blockSize);
                offset = min % blockSize;
                await readBlock();
                curBlock.copy(buffer, buffOffset, 0);
                buffOffset += blockSize;
                bytes -= blockSize;
            }
            return buffer;
        }
        curBlock.copy(buffer, 0, offset);
        offset += bytes;
        return buffer;
    }
    while(true){
        const parsed = parse(CpioStruct, await read(CPIO_STRUCT_SIZE)) as any;
        if(parsed.c_magic !== MAGIC){
            throw new Error("Invalid magic number");
        }
        const namesize = parseInt(parsed.c_namesize, 16);
        const filesize = parseInt(parsed.c_filesize, 16);
        const name = (await read(namesize)).toString("ascii").slice(0,-1);
        // i've seen this implementation (link down below) on cpio to know how tf does that work
        // my main problem is that I thinked cpio would'nt care about the modulo being zero
        // also i tried 4 - (filesize % 4) but it didn't worked, now i know that
        // credits to finnp: https://github.com/finnp/cpio-stream/blob/cce4c9f743c9bf35a8bc09026c252b697d8431bf/lib/newc.js#L49
        await read(4 - (((CPIO_STRUCT_SIZE + namesize) % 4) || 4));
        const content = await read(filesize);
        await read(4 - ((filesize % 4) || 4));
        if(name === "TRAILER!!!"){
            break;
        }
        const modeNum = parseInt(parsed.c_mode, 16);
        const type = parseType(modeNum);
        const entry: Entry = {
            name,
            modificationTime: new Date(parseInt(parsed.c_mtime, 16) * 1000),
            device: (BigInt(parseInt(parsed.c_devmajor, 16)) << 32n) | BigInt(parseInt(parsed.c_devminor, 16)),
            inode: parseInt(parsed.c_ino, 16),
            ownerUID: parseInt(parsed.c_uid, 16),
            ownerGID: parseInt(parsed.c_gid, 16),
            size: filesize,
            mode: {
                suid: Boolean(modeNum & 0o0004000),
                sgid: Boolean(modeNum & 0o0002000),
                sticky: Boolean(modeNum & 0o0001000),
                type,
                permission: parsePermissions(modeNum & 0o0000777)
            },
            content: type === "directory" ? null : // ternary operator madness 😢
                        (type === "blockDev" || type === "charDev") ?
                            { major: parseInt(parsed.c_rdevmajor, 16), minor: parseInt(parsed.c_rdevminor, 16) } 
                            : content,
        };
        yield entry;
    }
    return nextBlock;
}