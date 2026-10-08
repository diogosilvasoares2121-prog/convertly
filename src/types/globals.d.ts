declare const __APP_VERSION__: string;
/** Public source code repository (https URL), required by the GPL. */
declare const __APP_SOURCE_URL__: string;

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    has_alpha_channel(): boolean;
    display(target: ImageData, cb: (result: ImageData | null) => void): void;
    free(): void;
  }
  export interface HeifDecoderInstance {
    decoder: unknown;
    decode(data: Uint8Array): HeifImage[];
  }
  export interface LibHeif {
    HeifDecoder: new () => HeifDecoderInstance;
    heif_context_free(ctx: unknown): void;
  }
  const factory: (opts?: Record<string, unknown>) => LibHeif;
  export default factory;
}

declare module 'utif' {
  export interface IFD {
    width: number;
    height: number;
    [key: string]: unknown;
  }
  export function decode(buffer: ArrayBuffer | Uint8Array): IFD[];
  export function decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: IFD, ifds?: IFD[]): void;
  export function toRGBA8(ifd: IFD): Uint8Array;
  const UTIF: {
    decode: typeof decode;
    decodeImage: typeof decodeImage;
    toRGBA8: typeof toRGBA8;
  };
  export default UTIF;
}
