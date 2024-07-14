import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { hasFormat, parseCPIOStream, supportedFormats } from "./lib";
import * as yargs from "yargs";

const allOptions = yargs.options({
    i: { alias: "extract", type: "boolean" },
    o: { alias: "create", type: "boolean" },
    t: { alias: "list", type: "boolean" },

    d: { alias: "--make-directories", type: "boolean", default: false },
    v: { alias: "verbose", type: "boolean", default: false },
    V: { alias: "dot", type: "boolean", default: false},
    D: { alias: "directory", type: "string", default: process.cwd() },
    H: { alias: "format", type: "string", default: "newc" },
    q: { alias: "quiet", type: "boolean", default: false },
    C: { alias: "io-size", type: "number", default: 512 }
}).parseSync()

interface ExtractOptions{
    makeDirectories: boolean;
    verboseType: "none" | "normal" | "dot",
    relativePath: string;
    format: string;
    blockSize: number;
}
function extract(options: ExtractOptions){
    (async function(){
        const gen = parseCPIOStream(process.stdin, options.blockSize, options.format);
        
        while(true){
            const { done, value: entry } = await gen.next();
            if(done){
                if(options.verboseType === "dot")
                    console.log();
                if(!allOptions.q)
                    console.error(`${entry as number} blocks readen`);
                return;
            }
            switch(options.verboseType){
                case "dot":
                    process.stdout.write(".");
                    break;
                case "normal":
                    console.log(entry.name);
                    break;
                case "none":
                    break;
            }
            switch(entry.mode.type){
                case "file":
                    mkdirSync(join(options.relativePath, entry.name, ".."), {recursive: true});
                    writeFileSync(join(options.relativePath, entry.name), entry.content as Buffer);
                    break;
                case "directory":
                    mkdirSync(join(options.relativePath, entry.name), {recursive: true});
                    break;
                case "fifo":
                case "socket":
                case "symbolic":
                case "blockDev":
                case "charDev":
                    mkdirSync(join(options.relativePath, entry.name, ".."), {recursive: true});
                    console.error(`Warning: "${entry.name}" doesn't exist due to node limitations. Creating folders instead.`);
                    break;
            }
        }
    })();
}
let format = allOptions.H;
if(!hasFormat(format)){
    console.error(`Unsupported format: "${format}". Supported formats: ${supportedFormats.join(", ")}`);
    process.exit(2);
}
if(allOptions.i){
    extract({
        makeDirectories: allOptions.d,
        verboseType: allOptions.v ? "normal" : allOptions.V ? "dot" : "none",
        relativePath: allOptions.D,
        format,
        blockSize: allOptions.C
    });
}else if(allOptions.o){
    console.error("Unsupported (by now).");
}else if(allOptions.t){
    (async function(){
        const generator = parseCPIOStream(process.stdin, allOptions.C, format);
        while(true){
            const { value, done } = await generator.next();
            if(done){
                if(!allOptions.q)
                    console.error(`${value as number} blocks readen`);
                return;
            }
        }
    })();
}else{
    console.error("You must specify one of -opit options\nTry 'cpio --help' for more information");
    process.exitCode = 1;
}