const testCase = require("mocha").describe;
const pre = require("mocha").before;
const assertions = require("mocha").it;
const assert = require("chai").assert;
// const fs = require("fs");
// const fsp = require("fs-promise");

let fs = require('fs');
let wav = require('node-wav');

const Reader = require("../dist/index").Reader;
const Slicer = require("../dist/index").Slicer;

describe('Reader', () => {
  it('should read infos and extract buffer', (done) => {

  const INFILEPATH = "./test/example.wav";

  const reader = new Reader();

  reader.loadBuffer(INFILEPATH, (buffer) => {

      let metaBuffer = reader.interpretHeaders(buffer);

      // assert.isTrue(true);

      let refBuffer = fs.readFileSync(INFILEPATH);
      let refMetaBuffer = wav.decode(refBuffer);

      // check number of channels
      let refNumberOfChannels = refMetaBuffer.channelData.length;
      assert.equal(refNumberOfChannels, metaBuffer.numberOfChannels);

      // check file duration
      let refDuration = refMetaBuffer.channelData[1].length / refMetaBuffer.sampleRate;
      let duration = metaBuffer.dataLength / metaBuffer.secToByteFactor
      assert.equal(refDuration, duration);
      done();

    });
  });
});


// different test format to test callback (rather than promise)
describe('Slicer', () => {
  const INFILEPATH = "./test/example.wav";
  const INFILEPATH_4CH = "./test/example4ch.wav";

  describe('Slice .wav file to mp3', () => {
    it('should slice wav into mp3 chunks', (done) => {
      let slicer = new Slicer({compress:true, duration:2, overlap:0.005});
      slicer.slice(INFILEPATH, (chunkList) => { done(); });
    });
  });

  describe('Slice .wav file to wav', () => {
    it('should slice wav into wav chunks', (done) => {
      let slicer = new Slicer({compress:false, duration:1});
      slicer.slice(INFILEPATH, (chunkList) => { done(); });
    });
  });

  describe('Slice 4ch .wav + auto detect', () => {
    it('should slice wav into wav chunks', (done) => {
      let slicer = new Slicer({compress:true});
      slicer.slice(INFILEPATH_4CH, (chunkList) => { done(); });
    });
  });


});
