declare module 'lamejs' {
    export const MPEGMode: {
        STEREO: number;
        JOINT_STEREO: number;
        DUAL_CHANNEL: number;
        MONO: number;
    };

    export class Mp3Encoder {
        constructor(channels: number, samplerate: number, kbps: number);
        encodeBuffer(left: Int16Array, right: Int16Array): Int8Array;
        flush(): Int8Array;
    }

    // Default export for compatibility with dynamic imports
    const lamejs: {
        Mp3Encoder: typeof Mp3Encoder;
        MPEGMode: typeof MPEGMode;
    };
    export default lamejs;
}
