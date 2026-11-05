// Values exported by twenty-sdk/define exist only at build time: in a bundled
// front component or logic function, the build replaces them with an empty
// stub, so they read as undefined. Code that runs keeps its own copy, and a
// unit test keeps it equal to the SDK's.
export const COMPANY_OBJECT_UNIVERSAL_IDENTIFIER =
  '20202020-b374-4779-a561-80086cb2e17f';
