# node-audio-slicer

Read, slice, and write back audio files to disk (supported formats: .wav and .mp3). Used e.g. for streaming service to prepare audio chunks for greedy clients.

## Installation

npm install:

``` bash
$ npm install --save node-audio-slicer
```

This package relies on [node-lame](https://github.com/jankarres/node-lame) for mp3 encoding. Check the repository for requirements (no windows + lame installed at the moment).

## Supported Formats

Slice [.wav] to [.wav or .mp3]

## Examples

### Slice wav file into .mp3 chunks

load demo.wav, slice it into mp3 chunks saved in a ```myAudioFile``` directory created beside the ```myAudioFile.wav``` file.

``` node
const Slicer = require("node-audio-slicer").Slicer;
let slicer = new Slicer({compress:true});
slicer.slice('myAudioFile.wav', (chunkList) => {
    console.log('done', chunkList);
});
```