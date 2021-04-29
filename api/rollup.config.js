import resolve from '@rollup/plugin-node-resolve';
import cjs from '@rollup/plugin-commonjs';
import asset from './lib/asset-plugin.js';
import json from './lib/json-plugin.js';
import autojson from './lib/autojson-plugin.js';
import { getBabelOutputPlugin } from '@rollup/plugin-babel';
import OMT from '@surma/rollup-plugin-off-main-thread';

/** @type {import('rollup').RollupOptions} */
export default {
  input: 'src/index.js',
  output: {
    dir: 'build',
    format: 'es',
    assetFileNames: '[name]-[hash][extname]',
  },
  plugins: [
    resolve(),
    cjs(),
    asset(),
    OMT(),
    autojson(),
    json(),
    getBabelOutputPlugin({
      babelrc: false,
      configFile: false,
      minified: false, //process.env.DEBUG != '',
      comments: false,
      presets: [
        [
          '@babel/preset-env',
          {
            targets: {
              node: 12,
            },
            loose: true,
          },
        ],
      ],
    }),
  ],
};
