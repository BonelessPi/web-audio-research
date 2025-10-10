class MyProcessor extends AudioWorkletProcessor {
      // …
      process(inputList, outputList, parameters) {
        const sourceLimit = Math.min(inputList.length, outputList.length);

        for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
          const input = inputList[inputNum];
          const output = outputList[inputNum];
          const channelCount = Math.min(input.length, output.length);

          for (let channelNum = 0; channelNum < channelCount; channelNum++) {
            let zcs = 0;
            input[channelNum].forEach((sample,i) => {zcs += i>0 && sample*input[channelNum][i-1]<=0;});
            if (zcs <= 4) {
              input[channelNum].forEach((sample, i) => {
                // Manipulate the sample
                output[channelNum][i] = sample;
              });
            } else {
              output[channelNum].forEach((_,i) => {output[channelNum][i] = 0;});
            }
          }
        }

        return true;
      }
    }

registerProcessor('my-processor', MyProcessor);
