declare module '*.svg' {
  import * as React from 'react';
  import { SvgProps } from 'react-native-svg';
  const content: React.FC<SvgProps>;
  export default content;
}

// A bare `import './global.css'` is checked since TypeScript 6. Metro handles the
// file; this only tells the compiler the import is allowed.
declare module '*.css';
