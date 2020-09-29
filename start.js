const spawn = require('child_process').spawn;
var argv = require('minimist')(process.argv.slice(2));
let sourceContext = argv["source-context"] || argv["s"]
let destinationContext = argv["destination-context"] || argv["d"]
let ns = [];
if (argv["ns"]) {
    if (Array.isArray(argv["ns"])) {
        ns = argv["ns"];
    } else {
        ns = [argv["ns"]]
    }
    ns = ns.map(e => ["--ns", e]).flat();
}

if (!sourceContext) {
    console.log("No source context")
    process.exit(1);
}
if (!destinationContext) {
    console.log("No destinationContext")
    process.exit(1);
}
(async function () {
    let sourceCommand = null;
    let destinationCommand = null;
    let migrationCommand = null;
    try {
        sourceCommand = await runProcess(`kubectl`, ["proxy", "--context", sourceContext]);
        destinationCommand = await runProcess(`kubectl`, ["proxy", "--context", destinationContext, "--port", "8011"]);
        migrationCommand = await runProcess("node", ["dist/index.js"].concat(ns), () => {
            sourceCommand.kill();
            destinationCommand.kill();
        });


    } catch (error) {
        console.error(error)

        sourceCommand.kill();
        destinationCommand.kill();
        migrationCommand.kill();
    }
    finally {

    }


})();



function runProcess(command, args, onClose = () => { }) {
    let cmd = spawn(command, args);
    let promise = new Promise((resolve, reject) => {
        cmd.stdout.on('data', (data) => {
            let dt = data.toString();
            if (dt.indexOf("Starting to serve") > -1) {
                resolve(cmd);
            }
            console.log(dt);
        });
        cmd.stderr.on("data", data => {
            console.log(`stderr: ${data}`);
        });
        cmd.on('error', (error) => {
            reject(error)
            console.log(`error: ${error.message}`);
        });

        cmd.on("close", code => {
            console.log(`${command} process exited with code ${code}`);
            onClose();
        });

    });
    return promise;
}