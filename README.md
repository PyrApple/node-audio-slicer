node-audio-slicer
=================

Read, slice, and write back audio files to disk (supported formats: .wav and .mp3). Used e.g. for streaming service to prepare audio chunks for greedy clients.

Installation
------------

npm install:

``` bash
$ npm install --save node-audio-slicer
```

This package relies on [node-lame](https://github.com/jankarres/node-lame) for mp3 encoding. Check the repository for requirements (no windows + lame installed at the moment).

Examples
--------

### Slice mp3 file into chunks
``` node
const Slicer = require("node-audio-slicer").Slicer;
let slicer = new Slicer();
slicer.slice('demo.mp3', (chunkList) => {
    console.log('done', chunkList);
});
```