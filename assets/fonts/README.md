# Contract PDF Chinese font

Noto Sans SC Regular is distributed under SIL Open Font License 1.1. The complete upstream license and copyright notice are in `OFL.txt`.

Official font source (Google Fonts CDN):
https://fonts.gstatic.com/s/notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf

Official family and license source:
https://github.com/google/fonts/tree/main/ofl/notosanssc

Downloaded TTF SHA-256: `450625c8d46ab3df97b7904ded955ec2746d17ec76740cb1e91d1ba63a0f89af`

The complete TTF is compressed with zlib. All original glyphs and table data are retained; this is not a limited common-character subset. The compressed SHA-256 is `f1b79198b661c39e55479958f81af0f007159bc3dde5b8d7075fd6d3a1a22795`; the compressed size is 6,273,765 bytes. Keeping the original TTF container avoids fontkit repeatedly decompressing WOFF tables during shaping.

`contract-cjk-font.ts` embeds the compressed TTF bytes as base64 for the server PDF renderer. Workers use the standard `DecompressionStream('deflate')` once per isolate and cache the decompressed bytes, so generation needs no filesystem or external font request. Each generated PDF embeds the complete original font with pdf-lib/fontkit. Complete embedding is intentional: this fontkit version loses some CJK outlines when subsetting small custom templates despite valid text extraction. PDF fixtures are approximately 6.4MB with complete Chinese rendering. Characters absent from the upstream font cause a clear error rather than a silent missing-glyph square.
