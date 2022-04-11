const workerProcesseesEnum = {
    gen_schema: 'gen_schema',
    gen_server: 'gen_server',
    destroy_server: 'destroy_server',
    init: 'init',
    preLoad: 'preload'
}

const workerCommandEnum = {
    destroyInternalServer: 'destroyinternalserver',
    init: 'init',
    generate: 'generate',
    preLoad: 'preload',
    generateCached: 'generatecached'
}

const workerStatusEnum = {
    idle: 'idle',
    busy: 'busy'
}

const workerProcessStatusEnum = {
    complete: 'complete',
    running: 'running',
    failed: 'failed'
}

exports.workerProcesseesEnum = workerProcesseesEnum;
exports.workerCommandEnum = workerCommandEnum;
exports.workerStatusEnum = workerStatusEnum;
exports.workerProcessStatusEnum = workerProcessStatusEnum;
