"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// const LameOptions_1 = require("./LameOptions");
const fs = require("fs");
const Lame = require("node-lame").Lame;
const StringDecoder = require('string_decoder').StringDecoder;

const BYTE_LENGTH = 4;

class Slicer {
  constructor(options) {
    // options
    if( options === undefined ){ options = {}; }
    this.tmpPath = (options.tmpPath !== undefined) ? options.tmpPath : undefined;
    this.chunkDuration = (options.duration !== undefined) ? options.duration : 4; // chunk duration, in seconds
    this.compress = (options.compress !== undefined) ? options.compress : true; // output chunk audio format
    this.overlapDuration = (options.overlap !== undefined) ? options.overlap : 0; // overlap duration, in seconds
    this.generateChunksWavHeader = options.generateChunksWavHeader !== undefined ? options.generateChunksWavHeader : true; // generate valid wav header on outputted chunks

    // locals
    this.reader = new Reader();
  }

  slice(inFilePath, callback) {
    // only support wav and mp3 files
    var inFileExtension = inFilePath.split(".").pop();
    if( inFileExtension !== 'wav' ){
      console.error('only supports wav files input');
      return;
    }

    // load audio file
    this.reader.loadBuffer(inFilePath, (buffer) => {
        // get buffer chunk
        const metaBuffer = this.reader.interpretHeaders(buffer);

        // get chunk path radical and extension
        const inPath = inFilePath.substr(0, inFilePath.lastIndexOf('/') + 1);
        const inFileName = inFilePath.split("/").pop();
        const inFileRadical = inFileName.substr(0, inFileName.lastIndexOf("."));
        
        // set extension based on compression option (compress to mp3 if <= 2 channels)
        let extension = inFileExtension;
        if( this.compress && metaBuffer.numberOfChannels <= 2 ){
          extension = 'mp3'; 
        }     

        // create sub-directory to store sliced files
        const storeDirPath = inPath + inFileRadical;
        if (!fs.existsSync(storeDirPath)){ fs.mkdirSync(storeDirPath); }

        // init slicing loop 
        const totalDuration = metaBuffer.dataLength / metaBuffer.secToByteFactor;
        let chunkStartTime = 0;
        let chunkDuration = this.chunkDuration;
        let chunkIndex = 0;
        let totalEncodedTime = 0;
        let chunkList = [];
        let initStartBitOffset = 0;

        // slicing loop
        while( chunkStartTime < totalDuration){

          // handle last chunk duration (if needs to be shortened)
          chunkDuration = Math.min(chunkDuration, totalDuration - chunkStartTime);

          // get chunk name
          let chunkPath = storeDirPath + '/' + chunkIndex + '-' + inFileRadical + '.' + extension;

          // define start / end offset to take into account 
          let startOffset = (chunkStartTime === 0) ? 0 : this.overlapDuration;
          let endOffset = ( (chunkStartTime + chunkDuration + this.overlapDuration) < totalDuration) ? this.overlapDuration : 0;
          let chunkStartBitIndex = metaBuffer.dataStart + (chunkStartTime - startOffset) * metaBuffer.secToByteFactor;
          let chunkEndBitIndex = chunkStartBitIndex + (chunkDuration + endOffset) * metaBuffer.secToByteFactor;

          // tweek start / stop offset times to make sure they do not fall in the middle of a sample's bits 
          // (and update startOffset / endOffset to send exact values in output chunkList for overlap compensation in client code)
          if( chunkIndex !== 0 ){ // would not be wise to fetch index under data start for first chunk
            chunkStartBitIndex = initStartBitOffset + Math.floor( chunkStartBitIndex / metaBuffer.bitPerSample ) * metaBuffer.bitPerSample;
            startOffset = chunkStartTime - (chunkStartBitIndex - metaBuffer.dataStart) / metaBuffer.secToByteFactor;

            chunkEndBitIndex = Math.ceil( chunkEndBitIndex / metaBuffer.bitPerSample ) * metaBuffer.bitPerSample;
            chunkEndBitIndex = Math.min( chunkEndBitIndex, metaBuffer.dataStart + metaBuffer.dataLength ); // reduce if above file duration
            endOffset = (chunkEndBitIndex - chunkStartBitIndex) / metaBuffer.secToByteFactor - chunkDuration;
          }
          // keep track off init dta start offset
          else{ initStartBitOffset = chunkStartBitIndex % metaBuffer.bitPerSample; }

          // get chunk buffer
          let chunkBuffer = this.getChunk(metaBuffer, chunkStartTime, chunkDuration, chunkStartBitIndex, chunkEndBitIndex);

          // need mp3 outputs
          if( extension === 'mp3' ){
            // need to encode segmented wav buffer to mp3
            let encoder = new Lame({ "output": chunkPath, "bitrate": 128});
            encoder.setBuffer(chunkBuffer);
            encoder.encode()
              .then( () => { 
                // to be able to tell when to call the output callback:
                totalEncodedTime += this.chunkDuration;
                // run arg callback only at encoding's very end
                if( totalEncodedTime >= totalDuration ){ callback( chunkList ); }
              })
              .catch( (err) => {console.error(err);} );
          }
          // need wav output
          else{
            fs.writeFile( chunkPath, chunkBuffer, (err) => {
              if( err ){ throw err; }
              // to be able to tell when to call the output callback:
              totalEncodedTime += this.chunkDuration;
              // run arg callback only at encoding's very end
              if( totalEncodedTime >= totalDuration ){ callback( chunkList ); }
            });
          }

          // incr.
          chunkList.push( { name:chunkPath, start:chunkStartTime, duration: chunkDuration, overlapStart: startOffset, overlapEnd: endOffset });
          chunkIndex += 1;
          chunkStartTime += this.chunkDuration;
        }
      });
  }

  /** 
  * get chunk out of audio file (extract part of an audio buffer), 
  * starting at offset sec, of duration chunkDuration sec. Handles loop
  * (i.e. if offset >= buffer duration)
  **/
  getChunk(metaBuffer, offset, chunkDuration, chunkStart, chunkEnd){

    // utils
    const dataStart = metaBuffer.dataStart;
    const dataLength = metaBuffer.dataLength;
    const dataEnd = dataStart + dataLength;
    const inputBuffer = metaBuffer.buffer;

    // get head / tail buffers (unchanged)
    const headBuffer = inputBuffer.slice(0, dataStart ); // all until 'data' included
    const tailBuffer = inputBuffer.slice( dataStart + dataLength , metaBuffer.buffer.length ); // all after data values

    // get data buffer: default scenario (no need for loop)
    if( chunkEnd > dataEnd ) console.error('ERROR: fetched index greater than data end index:', chunkEnd, dataEnd);
    const dataBuffer = inputBuffer.slice( chunkStart, chunkEnd );
    
    // update data length descriptor in head buffer
    headBuffer.writeUIntLE(dataBuffer.length, headBuffer.length - BYTE_LENGTH, BYTE_LENGTH);
    if (this.generateChunksWavHeader) {
        const wavPcmLength = headBuffer.length + tailBuffer.length + dataBuffer.length;
        const headerBuffer = generateHeader(metaBuffer, wavPcmLength)
        // concatenate head / data / tail buffers
        return Buffer.concat([headerBuffer, headBuffer, dataBuffer, tailBuffer], headerBuffer.length + wavPcmLength);
      } else return Buffer.concat([headBuffer, dataBuffer, tailBuffer], headBuffer.length + tailBuffer.length + dataBuffer.length);
  }

}

exports.Slicer = Slicer;

/**
 * Description
 *
 * @class Reader
 */
class Reader {
    /**
     * Creates an instance of Reader and set all options
     * @param {Options} options
     */
    constructor() {
        this.wavFormatReader = new WavFormatReader();
    }

    /**
     * load fileName, return Node Buffer and extracted meta data
     *
     * @param {string} filePath
     */
    loadBuffer( filePath, callback ){
      try {
        const buffer = fs.readFileSync(filePath);
        callback(buffer); 
      } catch (err) { console.log(err); }    
    }

    interpretHeaders(buffer) {
        const wavInfo = this.wavFormatReader.getWavInfos(buffer);
        // extract relevant info only
        const metaBuffer = {
          buffer: buffer,
          dataStart: wavInfo.descriptors.get('data').start,
          dataLength: wavInfo.descriptors.get('data').length,
          numberOfChannels: wavInfo.format.numberOfChannels,
          sampleRate: wavInfo.format.sampleRate,
          secToByteFactor: wavInfo.format.secToByteFactor,
          bitPerSample: wavInfo.format.bitPerSample,
        };
        // resolve
        return metaBuffer;
    }

}
exports.Reader = Reader;

class WavFormatReader {
    constructor(){
        this.stringDecoder = new StringDecoder('utf8');
    }

    getWavInfos( buffer ){
      // console.log('input buffer length', buffer.length);
      // get header descriptors
      let descriptors = this.getWavDescriptors( buffer );
      // console.log(descriptors);
      // get format specific info
      let format = this.getWavFormat( descriptors, buffer );
      return { descriptors: descriptors, format: format };
    }

    // format info, see http://www.topherlee.com/software/pcm-tut-wavformat.html
    getWavFormat(descriptors, buffer) {
      let fmt = descriptors.get('fmt ');
      let format = { 
        type: buffer.readUIntLE( fmt.start, 2 ), 
        numberOfChannels: buffer.readUIntLE( fmt.start + 2, 2 ), 
        sampleRate: buffer.readUIntLE( fmt.start + 4, 4 ), 
        secToByteFactor: buffer.readUIntLE( fmt.start + 8, 4 ), // (Sample Rate * BitsPerSample * Channels) / 8
        weird: buffer.readUIntLE( fmt.start + 12, 2 ), // (BitsPerSample * Channels) / 8.1 - 8 bit mono2 - 8 bit stereo/16 bit mono4 - 16 bit stereo
        bitPerSample: buffer.readUIntLE( fmt.start + 14, 2 )
      };
      // console.log( format );
      return format;
    }

    getWavDescriptors(buffer) {
      // init header read
      let index = 0;
      let descriptor = '';
      let chunkLength = 0;
      const descriptors = new Map();

      // search for buffer descriptors
      let continueReading = true
      while( continueReading ){

        // read chunk descriptor
        let bytes = buffer.slice(index, index + BYTE_LENGTH);
        descriptor = this.stringDecoder.write(bytes);
        
        // special case for RIFF descriptor (header, fixed length)
        if( descriptor === 'RIFF' ){
        // read RIFF descriptor
        chunkLength = 3*BYTE_LENGTH;
        descriptors.set(descriptor, { start:index + BYTE_LENGTH, length: chunkLength } );
        // first subchunk will always be at byte 12
        index += chunkLength;
        }
        else{
          // account for descriptor length
          index += BYTE_LENGTH;

          // read chunk length
          chunkLength = buffer.readUIntLE(index, BYTE_LENGTH);

          // fill in descriptor map
          descriptors.set(descriptor, { start:index + BYTE_LENGTH, length: chunkLength } );

          // increment read index
          index += chunkLength + BYTE_LENGTH;
        }


        // stop loop when reached buffer end
        if( index >= buffer.length - 1 ){ return descriptors; }
      }
    }

}


/** Credits goes for https://github.com/karlwestin/node-waveheader/blob/master/index.js
 * Slightly modified code to generate wav headers
 */
function generateHeader(metaBuffer, length) {
  const RIFF = new Buffer.from('RIFF');
  const WAVE = new Buffer.from('WAVE');
  const fmt = new Buffer.from('fmt ');
  const data = new Buffer.from('data');

  const MAX_WAV = 4294967295 - 100;
  const format = 1; // raw PCM
  const channels = metaBuffer.numberOfChannels || 1;
  const sampleRate = metaBuffer.sampleRate || 44100;
  const bitDepth = metaBuffer.bitPerSample || 16;

  const headerLength = 44;
  const dataLength = length || MAX_WAV;
  const fileSize = dataLength + headerLength;
  const header = new Buffer.alloc(headerLength);
  const offset = 0;

  // write the "RIFF" identifier
  RIFF.copy(header, offset);
  offset += RIFF.length;

  // write the file size minus the identifier and this 32-bit int
  header.writeUInt32LE(fileSize - 8, offset);
  offset += 4;

  // write the "WAVE" identifier
  WAVE.copy(header, offset);
  offset += WAVE.length;

  // write the "fmt " sub-chunk identifier
  fmt.copy(header, offset);
  offset += fmt.length;

  // write the size of the "fmt " chunk
  // XXX: value of 16 is hard-coded for raw PCM format. other formats have
  // different size.
  header.writeUInt32LE(16, offset);
  offset += 4;

  // write the audio format code
  header.writeUInt16LE(format, offset);
  offset += 2;

  // write the number of channels
  header.writeUInt16LE(channels, offset);
  offset += 2;

  // write the sample rate
  header.writeUInt32LE(sampleRate, offset);
  offset += 4;

  // write the byte rate
  var byteRate = sampleRate * channels * bitDepth / 8;
  header.writeUInt32LE(byteRate, offset);
  offset += 4;

  // write the block align
  var blockAlign = channels * bitDepth / 8;
  header.writeUInt16LE(blockAlign, offset);
  offset += 2;

  // write the bits per sample
  header.writeUInt16LE(bitDepth, offset);
  offset += 2;

  // write the "data" sub-chunk ID
  data.copy(header, offset);
  offset += data.length;

  // write the remaining length of the rest of the data
  header.writeUInt32LE(dataLength, offset);
  offset += 4;

  // flush the header and after that pass-through "dataLength" bytes
  return header;
};