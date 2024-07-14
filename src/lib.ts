// R for read, S for stream, M for magic
import type { Entry } from "./common";
import type { Readable } from "stream";
import { parseCPIO as pwbR, parseCPIOStream as pwbRS, MAGIC as pwbM } from "./formats/pwb";
import { parseCPIO as odcR, parseCPIOStream as odcRS, MAGIC as odcM } from "./formats/odc";
import { parseCPIO as newcR, parseCPIOStream as newcRS, MAGIC as newcM } from "./formats/newc";
import { notStrictEqual } from "assert";

interface Format{
    buffer: (input: Buffer, blockSize: number) => Generator<Entry, number, unknown>;
    stream: (input: Readable, blockSize: number) => AsyncGenerator<Entry, number, unknown>;
    magic: number | string;
}
const formats: {[k: string]: Format} = {
    pwb: {
        buffer: pwbR,
        stream: pwbRS,
        magic: pwbM
    },
    odc: {
        buffer: odcR,
        stream: odcRS,
        magic: odcM
    },
    newc: {
        buffer: newcR,
        stream: newcRS,
        magic: newcM
    }
};
let supportedFormatsErrorMessage = `Invalid CPIO format. format must be ${Object.keys(formats).map(format => `"${format}"`).join(" or ")}`;

export const supportedFormats = Object.keys(formats);
/**
 * Returns true if has support on that format
 * @param format 
 * @returns true if has the specified format
 */
export function hasFormat(format: string){
    return formats[format] !== undefined;
}
/**
 * Parses a CPIO archive
 * @param input CPIO archive stored in a buffer
 * @param blockSize CPIO archive block size, if not sure leave this as 512
 * @param format CPIO archive format version, by default GNU CPIO uses bin (or pwb in node-cpio) and by default node-cpio uses newc
 * @yields CPIO entries
 * @returns Blocks readen
 */
export function parseCPIO(input: Buffer, blockSize: number = 512, format: string = "newc"){
    const formatObj = formats[format];
    notStrictEqual(formatObj, undefined, new Error(supportedFormatsErrorMessage));
    return formatObj.buffer(input, blockSize);
}
/**
 * Parses a CPIO archive
 * @param input CPIO archive stream
 * @param blockSize CPIO archive block size, if not sure leave this as 512
 * @param format CPIO archive format version, by default GNU CPIO uses bin (or pwb in node-cpio) and by default node-cpio uses newc
 * @yields CPIO entries
 * @returns Blocks readen
 */
export function parseCPIOStream(input: Readable, blockSize: number = 512, format: string = "newc"){
    const formatObj = formats[format];
    notStrictEqual(formatObj, undefined, new Error(supportedFormatsErrorMessage));
    return formatObj.stream(input, blockSize);
}