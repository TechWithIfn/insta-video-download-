declare module "json-bigint" {
  const JSONbig: (options?: { storeAsString?: boolean; useNativeBigInt?: boolean }) => {
    parse: (text: string) => unknown;
    stringify: (value: unknown) => string;
  };
  export default JSONbig;
}
