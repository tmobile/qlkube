const printColor = (msgType, msg) => {
    switch(msgType){
        case('blue'):{
            console.log("\x1b[34m%s\x1b[0m", msg);
            break;
        }
        case('red'):{
            console.log("\x1b[31m%s\x1b[0m", msg);
            break;
        }
        case('yellow'):{
            console.log('\x1b[33m%s\x1b[0m', msg);
            break;
        }
        case('green'):{
            console.log('\x1b[32m%s\x1b[0m', msg);
            break;
        }
        case('magenta'):{
            console.log('\x1b[35m%s\x1b[0m', msg);
            break;
        }
        default:{
            console.log(msg);
        }
    }
}

exports.printColor = printColor;