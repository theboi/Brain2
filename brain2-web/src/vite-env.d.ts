/// <reference types="vite/client" />

declare module '*.css' {
  const styles: Record<string, string>;
  export default styles;
}
