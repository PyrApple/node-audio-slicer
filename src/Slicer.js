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
    this.reader.loadBuffer(inFilePath)
      .then((buffer) => {
        // get buffer chunk
        let metaBuffer = this.reader.interpretHeaders(buffer);

        // get chunk path radical and extension
        let inPath = inFilePath.substr(0, inFilePath.lastIndexOf('/') + 1);
        let inFileName = inFilePath.split("/").pop();
        let inFileRadical = inFileName.substr(0, inFileName.lastIndexOf("."));
        
        // set extension based on compression option (compress to mp3 if <= 2 channels)
        let extension = inFileExtension;
        if( this.compress && metaBuffer.numberOfChannels <= 2 ){
          extension = 'mp3'; 
        }     

        // create sub-directory to store sliced files
        let storeDirPath = inPath + inFileRadical;
        if (!fs.existsSync(storeDirPath)){ fs.mkdirSync(storeDirPath); }

        // init slicing loop 
        let totalDuration = metaBuffer.dataLength / metaBuffer.secToByteFactor;
        let chunkStartTime = 0;
        let chunkDuration = this.chunkDuration;
        let chunkIndex = 0;
        let totalEncodedTime = 0;
        let chunkList = [];

        // slicing loop
        while( chunkStartTime < totalDuration){

          // handle last chunk duration (if needs to be shortened)
          chunkDuration = Math.min(chunkDuration, totalDuration - chunkStartTime);

          // get chunk name
          let chunkPath = storeDirPath + '/' + chunkIndex + '-' + inFileRadical + '.' + extension;

          // get chunk buffer
          let chunkBuffer = this.getChunk(metaBuffer, chunkStartTime, chunkDuration);

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
          chunkList.push( { name:chunkPath, start:chunkStartTime, duration: chunkDuration });
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
  getChunk(metaBuffer, offset, chunkDuration){

    // utils
    // console.log('1', metaBuffer.dataField, metaBuffer.format, metaBuffer.buffer)
    let dataStart = metaBuffer.dataStart;
    let dataLength = metaBuffer.dataLength;
    let dataEnd = dataStart + dataLength;
    let secToByteFactor = metaBuffer.secToByteFactor;
    let inputBuffer = metaBuffer.buffer;

    // get start index
    let chunkStart = dataStart + Math.floor( offset * secToByteFactor );
    // get end index
    let chunkEnd = chunkStart + Math.floor( chunkDuration * secToByteFactor );
    // get head / tail buffers (unchanged)
    let headBuffer = inputBuffer.slice(0, dataStart ); // all until 'data' included
    let tailBuffer = inputBuffer.slice( dataStart + dataLength , metaBuffer.buffer.length ); // all after data values
    // get data buffer

    // default scenario (no need for loop)
    // console.log('->', chunkEnd, dataEnd, chunkEnd/dataEnd)
    if( chunkEnd <= dataEnd ){
      var dataBuffer = inputBuffer.slice( chunkStart, chunkEnd );
    }
    // loop scenario
    else{
      console.error('ERROR: fetched index greater than data end index:', chunkEnd, dataEnd)
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
    let outputBuffer = Buffer.concat([headBuffer, dataBuffer, tailBuffer], headBuffer.length + tailBuffer.length + dataBuffer.length);

    return outputBuffer;
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
    loadBuffer( filePath ){
      const promise = new Promise((resolve, reject) => {
        fs.readFile( filePath, (err, buffer) => {
          // handle read error
          if (err) { 
            console.error(err)
            reject(err);
          }
          // read info from wav buffer
          resolve(buffer);
        });    
      });
      return promise;
    }

    interpretHeaders(buffer) {
        let wavInfo = this.wavFormatReader.getWavInfos(buffer);
        // extract relevant info only
        let metaBuffer = {
          buffer: buffer,
          dataStart: wavInfo.descriptors.get('data').start,
          dataLength: wavInfo.descriptors.get('data').length,
          numberOfChannels: wavInfo.format.numberOfChannels,
          sampleRate: wavInfo.format.sampleRate,
          secToByteFactor: wavInfo.format.secToByteFactor,
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
      let descriptors = new Map();

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
