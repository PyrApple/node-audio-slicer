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

testCase("Reader", () => {
  const INFILEPATH = "./test/example.wav";

  /**
   * @testname Read .wav file
   * read a .wav file, extract node buffer and info
   */
  assertions("Read .wav file", () => {

    const reader = new Reader();


    // assert.isTrue(true);

    return reader.loadBuffer(INFILEPATH)
      .then((buffer) => {

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

      });
  });

});


// different test format to test callback (rather than promise)
describe('Slicer', () => {
  const INFILEPATH = "./test/example.wav";
  const INFILEPATH_4CH = "./test/example4ch.wav";

  describe('Slice .wav file to mp3', () => {
    it('should slice wav into mp3 chunks', (done) => {
      let slicer = new Slicer({compress:true});
      slicer.slice(INFILEPATH, (chunkList) => { done(); });
    });
  });

  describe('Slice .wav file to wav', () => {
    it('should slice wav into wav chunks', (done) => {
      let slicer = new Slicer({compress:false});
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