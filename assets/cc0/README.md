# Audio MCP CC0 instrument bank

The bundled SoundFont contains 24 selected recordings. The source samples are dedicated to the public domain under [CC0 1.0](LICENSE.txt). The original recording projects and revisions are listed below.

| Preset | Recording credits and source | Selected recordings |
| --- | --- | --- |
| Marimba (GM program 12, zero-based) | [Versilian Community Sample Library, Versilian Studios and contributors](https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e) | Five pitches from the outrigger microphone, soft and medium strikes |
| Cello ensemble (42) | [VS Chamber Orchestra 2 Community Edition, Versilian Studios / Sam Gossner and Ivy Audio / Simon Dalzell](https://github.com/sgossner/VSCO-2-CE/tree/440300901dfe9275fd84e0b7763af1f8443ae62e) | Seven sustained vibrato recordings from the cello section |
| Acoustic drums (percussion bank 128, kit 0) | [Virtuosity Drums, Versilian Studios and Karoryfer Samples, performed by Austin McMahon](https://github.com/sfzinstruments/virtuosity_drums/tree/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc) | Kick, snare, closed and half-open hi-hat |

The bank uses 32 kHz mono PCM with pitch and velocity zones, trimmed onsets and short release fades. The renderer produces stereo output. The [build script](../../scripts/build_cc0_bank.py) identifies every source file and its mapping. Maintainers can rebuild the bank from the repository root with Python 3, curl, FFmpeg and network access:

```sh
python3 scripts/build_cc0_bank.py
```

The checked-in bank is used directly during offline rendering.
