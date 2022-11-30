const express = require('express');
require('dotenv').config();
const cors = require('cors');
const { logger } = require('./log');
const wsServer = require('http').createServer();
const WebSocketServer  = require('ws').Server;
const wss = new WebSocketServer({ server: wsServer });
const path = require('path');
const bodyParser = require('body-parser');
const process = require('process');
const nodeFs = require('fs');

const { normalizeData, dereferenceOpenApiSpec } = require('./oas');
const { generateServer } = require('./utils/generateGqlServer');
const { printColor } = require('./utils/consoleColorLogger');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
const inCluster = process.env.IN_CLUSTER !== 'false';

logger.info({ inCluster }, 'cluster mode configured');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const versionJSON = nodeFs.readFileSync(path.join(__dirname, '../public/health.json')).toString();
app.get('/health', (req, res) => {
  if(isPreloaded){
    res.setHeader('Content-Type', 'application/json');
    res.send(versionJSON);
  }
});
const PORT = 8080;

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', reason, p)
  logger.debug('This is probably from a closed websocket');
});

const dereferenceOas = async(oasRaw) => {
  try {
    if(!oasRaw?.definitions) throw new Error('unable to retrieve oas');
    const { subs, oas } = normalizeData(oasRaw);
    const derefSpec = await dereferenceOpenApiSpec(oas);
    if(derefSpec?.spec?.definitions){
      return {
        derefSpec,
        subs
      }
    }
    else throw new Error('unable to dereference oas')
  } catch (error) {
    printColor('red', error);
    return {
      error: { errorPayload: error }
    }
  }
}

const init = async() => {
  printColor('red', ` _______ _       _     _ _     _ ______  _______    _______ _______ ______  _______ \r\n(_______|_)     (_)   | (_)   (_|____  \\(_______)  (_______|_______|_____ \\(_______)\r\n _    _  _       _____| |_     _ ____)  )_____      _       _     _ _____) )_____   \r\n| |  | || |     |  _   _) |   | |  __  (|  ___)    | |     | |   | |  __  \/|  ___)  \r\n| |__| || |_____| |  \\ \\| |___| | |__)  ) |_____   | |_____| |___| | |  \\ \\| |_____ \r\n \\______)_______)_|   \\_)\\_____\/|______\/|_______)   \\______)\\_____\/|_|   |_|_______)\r\n                                                                                    `)
  try {
    
    if(process.env.clusterUrl){
      
      printColor('yellow', 'Retrieveing oas...');
      const fileName = 'oas.txt';

      // fetch oas txt file
      const rawOAS = nodeFs.readFileSync(`./oas/${fileName}`, 'utf8');

      const oasRaw = JSON.parse(rawOAS);
      const { derefSpec, subs }= await dereferenceOas(oasRaw);
      const { getSchema } = require('./utils/process-oas');
      const schema = await getSchema(derefSpec, subs);
      await generateServer(PORT, schema);
    }else throw new Error('Invalid env variables');
  } catch (error) {
    console.error(error);
  }
}

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', reason, p)
  logger.debug('This is probably from a closed websocket');
});

init();