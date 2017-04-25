node-audio-slicer
=================

Read, slice, and write back to disk audio files (supported formats: .wav and .mp3). Used e.g. for streaming service to prepare audio chunks for greedy clients.

Installation
------------

You can install it with `npm`:

``` bash
$ npm install --save node-audio-slicer
```

This package relies on [node-lame](https://github.com/jankarres/node-lame) for mp3 encoding. node-lame requirements:

* Linux or Mac OS (Windows is NOT tested by this package)
* lame installed (instructions see node-lame repo)
* node 6.9.* or newer

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