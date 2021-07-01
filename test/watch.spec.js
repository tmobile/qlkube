let chai = require('chai'); 
const watch = require('../src/watch');

describe('functions within watch.js', () => {
    const testWatchable= {abort:() => console.log('test')}
    const testIpAddress= '118.15.240.85';

    it('should add ip / watchable pair to watchMap', async() => {
        watch.setIpAddressWatchMap(testIpAddress, testWatchable);
        let testWatchMap= watch.getWatchMap()
        chai.assert.exists(testWatchMap[testIpAddress])
    });

    it('should remove ip address and its watchables from watch map', async() => {
        watch.disconnectWatchable(testIpAddress);
        let testWatchMap= watch.getWatchMap()
        chai.assert.notExists(testWatchMap[testIpAddress])
    });
})