import type { Readable } from "stream";

export interface POSIXPermission{
    read: boolean;
    write: boolean;
    executable: boolean;
}
export interface POSIXPermissions{
    world: POSIXPermission;
    group: POSIXPermission;
    user: POSIXPermission;
}
export interface EntryMode{
    /**
     * Type of the entry
     * - "file": Normal file
     * - "directory": Normal folder
     * - "charDev": Character devices
     * - "blockDev": Block devices
     */
    type: "file" | "directory" | "charDev" | "blockDev" | "fifo" | "symbolic" | "socket"

    /**
     * Set if the executable (file) can set it's UID
     */
    suid: boolean;
    /**
     * Set if the executable (file) can set it's GID
     */
    sgid: boolean;

    /**
     * POSIX permissions rwx for world, group and user
     */
    permission: POSIXPermissions;

    /**
     * NOTE: sticky bit *can* be applied to files, but most OSes don't care about that
     * @see https://en.wikipedia.org/wiki/Sticky_bit
     */
    sticky: boolean;
}
export interface Entry{
    /**
     * Entry name
     */
    name: string;
    /**
     * parsed `h_mode` of CPIO header
     * 
     * Contains information about if the entry has SUID/SGID, if it's sticky, it's modes and type
     */
    mode: EntryMode;
    /**
     * Size (in bytes)
     */
    size: number;
    /**
     * Last time the entry was modified
     */
    modificationTime: Date;
    /**
     * ID of the user that owns this entry
     */
    ownerUID: number;
    /**
     * ID of the group that owns this entry
     */
    ownerGID: number;

    /**
     * Device number of the entry, honestly? I dont know what that means, just...
     * don't reuse that number if you're not doing a hard link
     */
    device: bigint;
    /**
     * Inode number of the entry, honestly? I dont know what that means, just...
     * don't reuse that number if you're not doing a hard link
     */
    inode: number;

    /**
     * Content of the entry
     * 
     * For `mode.type` as `"file"` this is a Buffer, for `"directory"` this is null and for
     * others this is a major and minor device number
     */
    content: Buffer | { major: number, minor: number } | null
}

const _wait = (ms: number) => (new Promise(r => setTimeout(r,ms))) as Promise<void>;
export async function readStreamAsync(stream: Readable, bytes: number){
    if(stream.readableObjectMode)
        throw new Error("Readable cannot be in the object mode.");
    let result;
    if(bytes === 0){
        return Buffer.of();
    }
    if(stream.readableHighWaterMark >= bytes){
        while((result = stream.read(bytes)) === null)
            await _wait(0);
        return result as Buffer;
    }
    result = Buffer.alloc(bytes);
    let size = bytes;
    while(size > 0){
        let tempResult: Buffer;
        let min = Math.min(stream.readableHighWaterMark, size);
        while((tempResult = stream.read(min)) === null)
            await _wait(0);
        //result.copy(tempResult, bytes - size);
        tempResult.copy(result, bytes - size);
        size -= min;
    }
    return result;
}

export function parseType(type: number): ("file" | "directory" | "charDev" | "blockDev" | "fifo" | "symbolic" | "socket"){
    switch((type >>> 12) & 15){
        case 1:
            return "fifo";
        case 2:
            return "charDev";
        case 4:
            return "directory";
        case 6:
            return "blockDev";
        case 8:
            return "file";
        case 10:
            return "symbolic";
        case 12:
            return "socket";
        default:
            throw new Error(`${type}`)
    }
}
function parsePermissionBitfield(bitfield: number): POSIXPermission{
    return {
        read: Boolean(bitfield & 4),
        write: Boolean(bitfield & 2),
        executable: Boolean(bitfield & 1)
    }
}
export function parsePermissions(permissions: number): POSIXPermissions{
    const userPermission = (permissions & 0o700) >>> 6;
    const groupPermission = (permissions & 0o070) >>> 3;
    const worldPermission = permissions & 0o007;
    return {
        user: parsePermissionBitfield(userPermission),
        group: parsePermissionBitfield(groupPermission),
        world: parsePermissionBitfield(worldPermission)
    }
}