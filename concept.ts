import { openSync, readSync, closeSync, writeFileSync, mkdirSync } from "fs";
import { parse } from "structured-buffer";
import { MAGIC, CpioStruct, CPIO_STRUCT_SIZE } from "./src/common";
import { join } from "path";

const cpioStructBuf = Buffer.allocUnsafe(CPIO_STRUCT_SIZE);
const abc = openSync("./test.cpio", "r");
while(true){
    readSync(abc, cpioStructBuf);
    const parsed = parse(CpioStruct, cpioStructBuf) as any;
    if(parsed.h_magic !== MAGIC){
        throw new Error("oops");
    }
    parsed.mtime = new Date(parsed.h_mtime * 1000);
    cpioStructBuf.fill(0);
    const nameBuf = Buffer.allocUnsafe(parsed.h_namesize as number);
    readSync(abc, nameBuf);
    if(parsed.h_namesize & 1){
        readSync(abc, Buffer.allocUnsafe(1));
    }
    let name = nameBuf.toString("ascii").slice(0,-1);
    if(name === "TRAILER!!!"){
        break;
    }
    const data = Buffer.allocUnsafe(parsed.h_filesize as number);
    readSync(abc, data);
    console.log(parsed, name);
    if((parsed.h_namesize & 1) && (parsed.h_filesize & 1)){ // not sure how it did work but i think "The file data is then appended, again with an additional NUL appended if needed to get the next header at an even offset." resolved the even offset problem so... yeah
        readSync(abc, Buffer.allocUnsafe(1));
    }
    const isDir = parsed.h_mode & 0o0040000;
    if(isDir){
        mkdirSync(join(process.cwd(), "test", name), {recursive: true});
    }else{
        mkdirSync(join(process.cwd(), "test", name, ".."), {recursive: true});
        writeFileSync(join(process.cwd(), "test", name), data);
    }
}
closeSync(abc);