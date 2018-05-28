"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

Object.defineProperty(exports, "__esModule", { value: true });
// const LameOptions_1 = require("./LameOptions");
var fs = require("fs");
var Lame = require("node-lame").Lame;
var StringDecoder = require('string_decoder').StringDecoder;

var BYTE_LENGTH = 4;

var Slicer = function () {
  function Slicer(options) {
    _classCallCheck(this, Slicer);

    // options
    if (options === undefined) {
      options = {};
    }
    this.tmpPath = options.tmpPath !== undefined ? options.tmpPath : undefined;
    this.chunkDuration = options.duration !== undefined ? options.duration : 4; // chunk duration, in seconds
    this.compress = options.compress !== undefined ? options.compress : true; // output chunk audio format
    this.overlapDuration = options.overlap !== undefined ? options.overlap : 0; // overlap duration, in seconds

    // locals
    this.reader = new Reader();
  }

  _createClass(Slicer, [{
    key: "slice",
    value: function slice(inFilePath, callback) {
      var _this = this;

      // only support wav and mp3 files
      var inFileExtension = inFilePath.split(".").pop();
      if (inFileExtension !== 'wav') {
        console.error('only supports wav files input');
        return;
      }

      // load audio file
      this.reader.loadBuffer(inFilePath, function (buffer) {
        // get buffer chunk
        var metaBuffer = _this.reader.interpretHeaders(buffer);

        // get chunk path radical and extension
        var inPath = inFilePath.substr(0, inFilePath.lastIndexOf('/') + 1);
        var inFileName = inFilePath.split("/").pop();
        var inFileRadical = inFileName.substr(0, inFileName.lastIndexOf("."));

        // set extension based on compression option (compress to mp3 if <= 2 channels)
        var extension = inFileExtension;
        if (_this.compress && metaBuffer.numberOfChannels <= 2) {
          extension = 'mp3';
        }

        // create sub-directory to store sliced files
        var storeDirPath = inPath + inFileRadical;
        if (!fs.existsSync(storeDirPath)) {
          fs.mkdirSync(storeDirPath);
        }

        // init slicing loop 
        var totalDuration = metaBuffer.dataLength / metaBuffer.secToByteFactor;
        var chunkStartTime = 0;
        var chunkDuration = _this.chunkDuration;
        var chunkIndex = 0;
        var totalEncodedTime = 0;
        var chunkList = [];
        var initStartBitOffset = 0;

        // slicing loop
        while (chunkStartTime < totalDuration) {

          // handle last chunk duration (if needs to be shortened)
          chunkDuration = Math.min(chunkDuration, totalDuration - chunkStartTime);

          // get chunk name
          var chunkPath = storeDirPath + '/' + chunkIndex + '-' + inFileRadical + '.' + extension;

          // define start / end offset to take into account 
          var startOffset = chunkStartTime === 0 ? 0 : _this.overlapDuration;
          var endOffset = chunkStartTime + chunkDuration + _this.overlapDuration < totalDuration ? _this.overlapDuration : 0;
          var chunkStartBitIndex = metaBuffer.dataStart + (chunkStartTime - startOffset) * metaBuffer.secToByteFactor;
          var chunkEndBitIndex = chunkStartBitIndex + (chunkDuration + endOffset) * metaBuffer.secToByteFactor;

          // tweek start / stop offset times to make sure they do not fall in the middle of a sample's bits 
          // (and update startOffset / endOffset to send exact values in output chunkList for overlap compensation in client code)
          if (chunkIndex !== 0) {
            // would not be wise to fetch index under data start for first chunk
            chunkStartBitIndex = initStartBitOffset + Math.floor(chunkStartBitIndex / metaBuffer.bitPerSample) * metaBuffer.bitPerSample;
            startOffset = chunkStartTime - (chunkStartBitIndex - metaBuffer.dataStart) / metaBuffer.secToByteFactor;

            chunkEndBitIndex = Math.ceil(chunkEndBitIndex / metaBuffer.bitPerSample) * metaBuffer.bitPerSample;
            chunkEndBitIndex = Math.min(chunkEndBitIndex, metaBuffer.dataStart + metaBuffer.dataLength); // reduce if above file duration
            endOffset = (chunkEndBitIndex - chunkStartBitIndex) / metaBuffer.secToByteFactor - chunkDuration;
          }
          // keep track off init dta start offset
          else {
              initStartBitOffset = chunkStartBitIndex % metaBuffer.bitPerSample;
            }

          // get chunk buffer
          var chunkBuffer = _this.getChunk(metaBuffer, chunkStartTime, chunkDuration, chunkStartBitIndex, chunkEndBitIndex);

          // need mp3 outputs
          if (extension === 'mp3') {
            // need to encode segmented wav buffer to mp3
            var encoder = new Lame({ "output": chunkPath, "bitrate": 128 });
            encoder.setBuffer(chunkBuffer);
            encoder.encode().then(function () {
              // to be able to tell when to call the output callback:
              totalEncodedTime += _this.chunkDuration;
              // run arg callback only at encoding's very end
              if (totalEncodedTime >= totalDuration) {
                callback(chunkList);
              }
            }).catch(function (err) {
              console.error(err);
            });
          }
          // need wav output
          else {
              fs.writeFile(chunkPath, chunkBuffer, function (err) {
                if (err) {
                  throw err;
                }
                // to be able to tell when to call the output callback:
                totalEncodedTime += _this.chunkDuration;
                // run arg callback only at encoding's very end
                if (totalEncodedTime >= totalDuration) {
                  callback(chunkList);
                }
              });
            }

          // incr.
          chunkList.push({ name: chunkPath, start: chunkStartTime, duration: chunkDuration, overlapStart: startOffset, overlapEnd: endOffset });
          chunkIndex += 1;
          chunkStartTime += _this.chunkDuration;
        }
      });
    }

    /** 
    * get chunk out of audio file (extract part of an audio buffer), 
    * starting at offset sec, of duration chunkDuration sec. Handles loop
    * (i.e. if offset >= buffer duration)
    **/

  }, {
    key: "getChunk",
    value: function getChunk(metaBuffer, offset, chunkDuration, chunkStart, chunkEnd) {

      // utils
      var dataStart = metaBuffer.dataStart;
      var dataLength = metaBuffer.dataLength;
      var dataEnd = dataStart + dataLength;
      var inputBuffer = metaBuffer.buffer;

      // get head / tail buffers (unchanged)
      var headBuffer = inputBuffer.slice(0, dataStart); // all until 'data' included
      var tailBuffer = inputBuffer.slice(dataStart + dataLength, metaBuffer.buffer.length); // all after data values

      // get data buffer: default scenario (no need for loop)
      if (chunkEnd <= dataEnd) {
        var dataBuffer = inputBuffer.slice(chunkStart, chunkEnd);
      }
      // loop scenario
      else {
          console.error('ERROR: fetched index greater than data end index:', chunkEnd, dataEnd);
          // // loop over audio channels
          // for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          //   // copy channel to output, concatenating: output = [input_end, input_begin]
          //   outputBuffer.getChannelData(ch).set( Float32Concat( 
          //     buffer.getChannelData(ch).slice( startIndex, buffer.length ),
          //     buffer.getChannelData(ch).slice( 0, endIndex - buffer.length )
          //   ));
          // }
        }
      // update data length descriptor in head buffer
      headBuffer.writeUIntLE(dataBuffer.length, headBuffer.length - BYTE_LENGTH, BYTE_LENGTH);

      // concatenate head / data / tail buffers
      var outputBuffer = Buffer.concat([headBuffer, dataBuffer, tailBuffer], headBuffer.length + tailBuffer.length + dataBuffer.length);

      return outputBuffer;
    }
  }]);

  return Slicer;
}();

exports.Slicer = Slicer;

/**
 * Description
 *
 * @class Reader
 */

var Reader = function () {
  /**
   * Creates an instance of Reader and set all options
   * @param {Options} options
   */
  function Reader() {
    _classCallCheck(this, Reader);

    this.wavFormatReader = new WavFormatReader();
  }

  /**
   * load fileName, return Node Buffer and extracted meta data
   *
   * @param {string} filePath
   */


  _createClass(Reader, [{
    key: "loadBuffer",
    value: function loadBuffer(filePath, callback) {
      try {
        var buffer = fs.readFileSync(filePath);
        callback(buffer);
      } catch (err) {
        console.log(err);
      }
    }
  }, {
    key: "interpretHeaders",
    value: function interpretHeaders(buffer) {
      var wavInfo = this.wavFormatReader.getWavInfos(buffer);
      // extract relevant info only
      var metaBuffer = {
        buffer: buffer,
        dataStart: wavInfo.descriptors.get('data').start,
        dataLength: wavInfo.descriptors.get('data').length,
        numberOfChannels: wavInfo.format.numberOfChannels,
        sampleRate: wavInfo.format.sampleRate,
        secToByteFactor: wavInfo.format.secToByteFactor,
        bitPerSample: wavInfo.format.bitPerSample
      };
      // resolve
      return metaBuffer;
    }
  }]);

  return Reader;
}();

exports.Reader = Reader;

var WavFormatReader = function () {
  function WavFormatReader() {
    _classCallCheck(this, WavFormatReader);

    this.stringDecoder = new StringDecoder('utf8');
  }

  _createClass(WavFormatReader, [{
    key: "getWavInfos",
    value: function getWavInfos(buffer) {
      // console.log('input buffer length', buffer.length);
      // get header descriptors
      var descriptors = this.getWavDescriptors(buffer);
      // console.log(descriptors);
      // get format specific info
      var format = this.getWavFormat(descriptors, buffer);
      return { descriptors: descriptors, format: format };
    }

    // format info, see http://www.topherlee.com/software/pcm-tut-wavformat.html

  }, {
    key: "getWavFormat",
    value: function getWavFormat(descriptors, buffer) {
      var fmt = descriptors.get('fmt ');
      var format = {
        type: buffer.readUIntLE(fmt.start, 2),
        numberOfChannels: buffer.readUIntLE(fmt.start + 2, 2),
        sampleRate: buffer.readUIntLE(fmt.start + 4, 4),
        secToByteFactor: buffer.readUIntLE(fmt.start + 8, 4), // (Sample Rate * BitsPerSample * Channels) / 8
        weird: buffer.readUIntLE(fmt.start + 12, 2), // (BitsPerSample * Channels) / 8.1 - 8 bit mono2 - 8 bit stereo/16 bit mono4 - 16 bit stereo
        bitPerSample: buffer.readUIntLE(fmt.start + 14, 2)
      };
      // console.log( format );
      return format;
    }
  }, {
    key: "getWavDescriptors",
    value: function getWavDescriptors(buffer) {
      // init header read
      var index = 0;
      var descriptor = '';
      var chunkLength = 0;
      var descriptors = new Map();

      // search for buffer descriptors
      var continueReading = true;
      while (continueReading) {

        // read chunk descriptor
        var bytes = buffer.slice(index, index + BYTE_LENGTH);
        descriptor = this.stringDecoder.write(bytes);

        // special case for RIFF descriptor (header, fixed length)
        if (descriptor === 'RIFF') {
          // read RIFF descriptor
          chunkLength = 3 * BYTE_LENGTH;
          descriptors.set(descriptor, { start: index + BYTE_LENGTH, length: chunkLength });
          // first subchunk will always be at byte 12
          index += chunkLength;
        } else {
          // account for descriptor length
          index += BYTE_LENGTH;

          // read chunk length
          chunkLength = buffer.readUIntLE(index, BYTE_LENGTH);

          // fill in descriptor map
          descriptors.set(descriptor, { start: index + BYTE_LENGTH, length: chunkLength });

          // increment read index
          index += chunkLength + BYTE_LENGTH;
        }

        // stop loop when reached buffer end
        if (index >= buffer.length - 1) {
          return descriptors;
        }
      }
    }
  }]);

  return WavFormatReader;
}();