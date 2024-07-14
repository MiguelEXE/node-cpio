import type { Readable } from "stream";
import type { Entry } from "../common";
import { sizeof, uint16_le, pdp_uint32, parse } from "structured-buffer";
import { readStreamAsync, parsePermissions } from "../common";

export const MAGIC = 0o070707;
export const CpioStruct = { // https://man.archlinux.org/man/cpio.5.en
    /*
    short   h_magic;
    short   h_dev;
    short   h_ino;
    short   h_mode;
    short   h_uid;
    short   h_gid;
    short   h_nlink;
    short   h_majmin;
    long    h_mtime;
    short   h_namesize;
    long    h_filesize;
    */
    h_magic: uint16_le,
    h_dev: uint16_le,
    h_ino: uint16_le,
    h_mode: uint16_le,
    h_uid: uint16_le,
    h_gid: uint16_le,
    h_nlink: uint16_le,
    h_majmin: uint16_le,
    h_mtime: pdp_uint32,
    h_namesize: uint16_le,
    h_filesize: pdp_uint32,
};
export const CPIO_STRUCT_SIZE = sizeof(CpioStruct);

export function parseOldType(type: number): "file" | "directory" | "charDev" | "blockDev"{
    switch((type >>> 13) & 3){
        case 1:
            return "charDev";
        case 2:
            return "directory";
        case 3:
            return "blockDev";
        default:
            return "file";
    }
}
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
        if(parsed.h_magic !== MAGIC){
            throw new Error("Invalid magic number");
        }
        const name = read(parsed.h_namesize).toString("ascii").slice(0,-1);
        if(name === "TRAILER!!!"){ // haha funny "TRAILER!!!" 🤪🤪🤪🤪
            break;
        }
        if(parsed.h_namesize & 1){
            read(1);
        }
        const content = read(parsed.h_filesize);
        if((parsed.h_namesize & 1) && (parsed.h_filesize & 1)){ // not sure how it did work but i think "The file data is then appended, again with an additional NUL appended if needed to get the next header at an even offset." resolved the even offset problem so... yeah
            read(1);
        }
        const type = parseOldType(parsed.h_mode);
        const entry: Entry = {
            name,
            modificationTime: new Date(parsed.h_mtime * 1000),
            ownerUID: parsed.h_uid,
            ownerGID: parsed.h_gid,
            device: BigInt(parsed.h_dev),
            inode: parsed.h_ino,
            size: parsed.h_filesize,
            content: type === "directory" ? null : // ternary operator madness 😢
                        (type === "blockDev" || type === "charDev") ?
                            { major: parsed.h_majmin & 0xFF, minor: parsed.h_majmin >>> 8 } 
                            : content,
            mode: {
                suid: Boolean(parsed.h_mode & 0o0004000),
                sgid: Boolean(parsed.h_mode & 0o0002000),
                sticky: Boolean(parsed.h_mode & 0o0001000),
                type,
                permission: parsePermissions(parsed.h_mode & 0o0000777)
            }
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
            let buffOffset = remaining;
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
        if(parsed.h_magic !== MAGIC){
            throw new Error("Invalid magic number");
        }
        const name = (await read(parsed.h_namesize)).toString("ascii").slice(0,-1);
        if(name === "TRAILER!!!"){ // haha funny "TRAILER!!!" 🤪🤪🤪🤪
            break;
        }
        if(parsed.h_namesize & 1){
            await read(1);
        }
        const content = (await read(parsed.h_filesize));
        if((parsed.h_namesize & 1) && (parsed.h_filesize & 1)){ // not sure how it did work but i think "The file data is then appended, again with an additional NUL appended if needed to get the next header at an even offset." resolved the even offset problem so... yeah
            await read(1);
        }
        const type = parseOldType(parsed.h_mode);
        const entry: Entry = {
            name,
            modificationTime: new Date(parsed.h_mtime * 1000),
            ownerUID: parsed.h_uid,
            ownerGID: parsed.h_gid,
            device: BigInt(parsed.h_dev),
            inode: parsed.h_ino,
            size: parsed.h_filesize,
            content: type === "directory" ? null : // ternary operator madness 😢
                        (type === "blockDev" || type === "charDev") ?
                            { major: parsed.h_majmin & 0xFF, minor: parsed.h_majmin >>> 8 } 
                            : content,
            mode: {
                suid: Boolean(parsed.h_mode & 0o0004000),
                sgid: Boolean(parsed.h_mode & 0o0002000),
                sticky: Boolean(parsed.h_mode & 0o0001000),
                type,
                permission: parsePermissions(parsed.h_mode & 0o0000777)
            }
        };
        yield entry;
    }
    return nextBlock;
}