/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  serial as polyfill, SerialPort as SerialPortPolyfill,
} from 'web-serial-polyfill';

const encoder = new TextEncoder();

/**
 * Elements of the port selection dropdown extend HTMLOptionElement so that
 * they can reference the SerialPort they represent.
 */
let connectButton: HTMLButtonElement;
let sentButton: HTMLButtonElement;
let sentInput: HTMLInputElement;

let term: HTMLElement;
let con: HTMLElement;

let port: SerialPort | SerialPortPolyfill | undefined;
let reader: ReadableStreamDefaultReader | ReadableStreamBYOBReader | undefined;

let usePolyfill = false;
let supported = false;

const bufferSize = 8 * 1024; // 8kB


/**
 * Sets |port| to the currently selected port. If none is selected then the
 * user is prompted for one.
 */
async function getSelectedPort(): Promise<void> {
  try {
    const serial = usePolyfill ? polyfill : navigator.serial;
    con.innerHTML += '<pre>'+serial+'</pre><br>';
    port = await serial.requestPort({});
  } catch (e) {
    return;
  }
}


/**
 * Resets the UI back to the disconnected state.
 */
function markDisconnected(): void {
  con.innerHTML += '<pre>[disconnected]</pre><br>';
  connectButton.textContent = 'Connect';
  connectButton.disabled = false;
  sentButton.disabled = true;
  sentInput.disabled = true;
  port = undefined;
}

/**
 * Initiates a connection to the selected port.
 */
async function connectToPort(): Promise<void> {
  await getSelectedPort();
  if (!port) {
    return;
  }

  const options = {
    baudRate: 1000000,
    dataBits: 8,
    bufferSize,

    // Prior to Chrome 86 these names were used.
    baudrate: 1000000,
    databits: 8,
  };
  console.log(options);

  connectButton.textContent = 'Connecting...';
  // disable buttons...
  connectButton.disabled = true;
  sentButton.disabled = true;
  sentInput.disabled = true;

  try {
    await port.open(options);
    console.log('[connected]');
    con.innerHTML += '<pre>[connected]</pre><br>';
    connectButton.textContent = 'Disconnect';
    connectButton.disabled = false;
    sentButton.disabled = false;
    sentInput.disabled = false;
  } catch (e) {
    console.error(e);
    if (e instanceof Error) {
      console.log(`<ERROR: ${e.message}>`);
      con.innerHTML += '<pre><ERROR: ' + e.message + '</pre><br>';
    }
    markDisconnected();
    return;
  }

  while (port && port.readable) {
    try {
      try {
        reader = port.readable.getReader({mode: 'byob'});
      } catch {
        reader = port.readable.getReader();
      }

      let buffer = null;
      for (;;) {
        const {value, done} = await (async () => {
          if (reader instanceof ReadableStreamBYOBReader) {
            if (!buffer) {
              buffer = new ArrayBuffer(bufferSize);
            }
            const {value, done} =
                await reader.read(new Uint8Array(buffer, 0, bufferSize));
            buffer = value?.buffer;
            return {value, done};
          } else {
            return await reader.read();
          }
        })();

        if (value) {
          await new Promise<void>((resolve) => {
            let val = String.fromCharCode.apply(null, value);
            val = val.replace('\r', '');
            val = val.replace('\n', '</pre><br><pre>');
            term.innerHTML += ('<pre>'+val+'</pre>');
            resolve();
          });
        }
        if (done) {
          break;
        }
      }
    } catch (e) {
      console.error(e);
      await new Promise<void>((resolve) => {
        if (e instanceof Error) {
          con.innerHTML += '<pre><ERROR: ' + e.message + '</pre><br>';
          console.log(`<ERROR: ${e.message}>`, resolve);
        }
      });
    } finally {
      console.log('finally');
      if (reader) {
        reader.releaseLock();
        reader = undefined;
      }
    }
  }

  if (port) {
    try {
      await port.close();
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        console.log(`<ERROR: ${e.message}>`);
        con.innerHTML += '<pre><ERROR: ' + e.message + '</pre><br>';
      }
    }

    markDisconnected();
  }
}

/**
 * Closes the currently active connection.
 */
async function disconnectFromPort(): Promise<void> {
  // Move |port| into a local variable so that connectToPort() doesn't try to
  // close it on exit.
  const localPort = port;
  port = undefined;

  if (reader) {
    await reader.cancel();
  }

  if (localPort) {
    try {
      await localPort.close();
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        console.log(`<ERROR: ${e.message}>`);
        con.innerHTML += '<pre><ERROR: ' + e.message + '</pre><br>';
      }
    }
  }

  markDisconnected();
}


document.addEventListener('DOMContentLoaded', async () => {
  term = document.getElementById('terminal') as HTMLElement;
  con = document.getElementById('console') as HTMLElement;
  connectButton = document.getElementById('connect') as HTMLButtonElement;
  sentButton = document.getElementById('sent') as HTMLButtonElement;
  sentInput = document.getElementById('serial_send') as HTMLInputElement;

  sentButton.disabled = true;
  sentInput.disabled = true;

  if ('serial' in navigator) {
    usePolyfill = false;
    supported = true;
  } else {
    if ('usb' in navigator) {
      usePolyfill = true;
      supported = true;
    }
  }

  if (!supported) {
    term.innerHTML = '<pre>This browser is not supported'+
                    ' on your operating system!</pre><br>';
    connectButton.disabled = true;
    sentButton.disabled = true;
    sentInput.disabled = true;
    return;
  }

  connectButton.addEventListener('click', () => {
    if (port) {
      disconnectFromPort();
    } else {
      connectToPort();
    }
  });

  sentButton.addEventListener('click', () => {
    if (port?.writable == null) {
      console.warn(`unable to find writable port`);
      return;
    }

    const writer = port.writable.getWriter();
    const data = sentInput.value + '\n';
    writer.write(encoder.encode(data));
    writer.releaseLock();
  });

  const serial = usePolyfill ? polyfill : navigator.serial;
  const ports: (SerialPort | SerialPortPolyfill)[] = await serial.getPorts();
  console.log('ports:', ports);
});
