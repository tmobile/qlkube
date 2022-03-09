const workerProcesseesEnum = {
    gen_schema: 'gen_schema',
    gen_server: 'gen_server',
    destroy_server: 'destroy_server',
    init: 'init'
}

const workerCommandEnum = {
    destroyInternalServer: 'destroyinternalserver',
    init: 'init',
    generate: 'generate'
}

exports.workerProcesseesEnum = workerProcesseesEnum;
exports.workerCommandEnum = workerCommandEnum;
