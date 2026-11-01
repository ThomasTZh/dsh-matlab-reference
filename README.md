# dsh-matlab-reference

Two DeepSeek Harness tools over the official MathWorks Agentic Toolkit catalogue: search it, and read one skill section on request.

## Abstract

A toolkit catalogue of 120 skills makes an unfiltered skill root unusable: every entry lands in the model's catalogue and competes for attention. This plugin replaces that root with two bounded tools. The agent searches by intent, reads the one matching skill in sections of 6000 bytes, and continues with a `next_offset` when a section is truncated. The catalogue itself is read from a local install and is never copied or republished.

## Tools

| Tool | Parameters | Returns |
|---|---|---|
| `search_matlab_skills` | `query` (string, required), `limit` (integer, 1-4, default 2) | Ranked short results with the skill name and description. |
| `read_matlab_skill` | `name` (required), `section`, `resource`, `offset` | One section or a bounded page, with `next_offset` when more remains. |

Reading starts at offset 0 and returns the first sections; a result with a `next_offset` continues with the same `name`, `section`, and `resource`.

## The index

- Walks `catalogRoot` to depth 5, skipping entries that start with a dot.
- Accepts a `SKILL.md` only if its YAML front matter has a kebab-case `name` and a non-empty `description`; files over 512 KiB are skipped.
- Rejects duplicate skill names and an empty catalogue.
- Expands common aliases (`ecg`, `eeg`, `psd`, `cwt`, `dicom`, ...) and drops stop words before ranking.
- Pages are 6000 bytes and a JSON result is trimmed to stay under 8 KiB, so a tool call cannot return an unbounded catalogue dump.

## Configuration

| Key | Meaning |
|---|---|
| `catalogRoot` | Required. The toolkit's `skills-catalog` directory. |

## js-yaml

Front matter is parsed with the `js-yaml` copy bundled with the harness. The module locates that package from `DSH_PACKAGE_JSON` when set, otherwise from the launcher path (`dsh` to `lib/bin.js` to `package.json`). A moved harness needs the variable, and the test suite fails without it.

## Files

| Path | Contents |
|---|---|
| [`matlab-reference.mjs`](matlab-reference.mjs) | The plugin: catalogue index, ranking, bounded page reads |
| [`matlab-reference.test.mjs`](matlab-reference.test.mjs) | Two tests over a synthetic catalogue, plus an optional check against an installed toolkit |

## Install

```sh
LOCAL_AI=${LOCAL_AI:-$HOME/.config/local-ai}
git clone https://github.com/ThomasTZh/dsh-matlab-reference "$HOME/dsh-components/dsh-matlab-reference"
mkdir -p "$LOCAL_AI/plugins"
cp "$HOME/dsh-components/dsh-matlab-reference/matlab-reference.mjs" "$LOCAL_AI/plugins/matlab-reference.mjs"
```

Mount it in the MATLAB preset:

```yaml
- id: matlab-reference
  name: <absolute path to $LOCAL_AI>/plugins/matlab-reference.mjs
  config:
    catalogRoot: <toolkit root>/agentic-toolkits/matlab/skills-catalog
```

No profile dependency is needed, because the plugin is mounted by path rather than as a package.

## Verification

| Check | Command | Result |
|---|---|---|
| Unit tests | `DSH_PACKAGE_JSON=<harness package.json> node --test matlab-reference.test.mjs` | pass, 2 tests; the toolkit search test is skipped when no toolkit is installed |
| Module parses | `node --check matlab-reference.mjs` | pass |
| Missing harness variable | `node --test matlab-reference.test.mjs` without the variable | fails to resolve `js-yaml` from a launcher path this repository does not have; documented, not hidden |
| Live search | mounted in the MATLAB preset on the machine it was written for | pass: search returns ranked skills and a page read follows `next_offset` |

**Not tested:** a toolkit revision other than the one installed on the recording machine.

## Limitations

- Ranking is lexical, with a small alias table. It is not semantic search.
- The catalogue is re-read per search and per read; a very large catalogue increases latency rather than memory.
- The plugin needs a local toolkit install. Without one the tools fail at call time, which is why the optional test skips instead of asserting.

## Acknowledgements

The harness tool API is the work of the DeepSeek Harness project [1]. The catalogue it reads is the MATLAB Agentic Toolkit, MathWorks' [2]; no toolkit file is distributed here. Front matter parsing uses `js-yaml`, bundled with the harness [3].

## References

1. DeepSeek Harness. <https://github.com/deepseek-ai/deepseek-harness>. MIT.
2. MATLAB Agentic Toolkit. <https://github.com/matlab/matlab-agentic-toolkit>. MathWorks BSD-3-Clause, use restricted to MathWorks products.
3. `js-yaml`. <https://github.com/nodeca/js-yaml>. MIT.
