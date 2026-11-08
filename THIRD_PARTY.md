# Third-party software and attribution

No upstream code, text, or dataset is included in this repository. This file records what the plugin runs on and reads.

## Host and dependencies

| Component | Role here | Project | Licence | Distribution |
|---|---|---|---|---|
| DeepSeek Harness | Host: the tool API, the agent session, and the bundled `js-yaml` the plugin resolves at runtime | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | MIT | installed separately, not vendored |
| `js-yaml` | YAML front matter parsing, resolved from the harness install; a built-in parser covers the case where it is unreachable | [nodeca/js-yaml](https://github.com/nodeca/js-yaml) | MIT | bundled with the harness, not vendored here |
| MATLAB Agentic Toolkit | The catalogue read at call time: skill files, descriptions, and resources | [matlab/matlab-agentic-toolkit](https://github.com/matlab/matlab-agentic-toolkit) | MathWorks BSD-3-Clause, use restricted to MathWorks products | installed separately, not vendored or redistributed |
| Node.js | Runtime for the plugin and its tests | <https://nodejs.org> | MIT | installed separately |

The toolkit is read from a local install at the path given in `catalogRoot`. No catalogue file, skill text, or index is copied into this repository; only the directory walker and the ranking rules are original.

## Copyright and licence compliance

- **Original files:** the MIT [`LICENSE`](LICENSE) covers `matlab-reference.mjs`, `matlab-reference.test.mjs`, and the documentation in this repository.
- **Upstream notices:** none are redistributed, because no upstream file is present here.
- **Restricted component:** the MathWorks toolkit is licensed for use with MathWorks products. It is neither copied nor relicensed here, and the plugin only reads it on the machine that installed it.
- **Unresolved:** none.
