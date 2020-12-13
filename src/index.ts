import fetch from 'node-fetch'
import fs from 'fs'
import minimist from 'minimist';
import winston, {format} from 'winston';
const {printf} = format;

const myFormat = printf(({ level, message,metadata }) => {
    let t = metadata.timestamp;
    delete metadata.timestamp;

    return `${t}  ${level}: ${message} ${JSON.stringify(metadata)}`;
  });

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(winston.format.timestamp(),winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});
logger.add(new winston.transports.Console({
    level:"info",
    format: winston.format.combine(winston.format.timestamp(), winston.format.metadata(), myFormat),
  }));

var argv = minimist(process.argv.slice(2));
logger.info(JSON.stringify(argv))


const SOURCE_PROXY = argv["source"] || "http://localhost:8001";
const TARGET_PROXY = argv["target"] || "http://localhost:8011";
let ns = argv["ns"] || ["example_ns"]
let override = argv["override"] === true;
const NAMESPACES = Array.isArray(ns) ? ns : [ns];

logger.info(`Starting migration from ${SOURCE_PROXY} to ${TARGET_PROXY}. Namespaces: ${ns}`);

(async function () {
    let sourceLogger = logger.child({source: SOURCE_PROXY});
    let targetLogger = logger.child({target: TARGET_PROXY});

    sourceLogger.info("Connecting to source")
    let resourcesToRecreate: any[] = await getAvaiableResourcesOnCluster(SOURCE_PROXY);
    sourceLogger.info(`Connected. Found ${resourcesToRecreate.length} resources` )

    targetLogger.info("Connecting to target")
    let resourcesOnTarget: any[] = await getAvaiableResourcesOnCluster(TARGET_PROXY);
    targetLogger.info(`Connected. Found ${resourcesOnTarget.length} resources` )

    let diff = resourcesToRecreate.filter(e => resourcesOnTarget.every(tr => tr.path + tr.name != e.path + e.name));
    if (diff.length > 0) {
        targetLogger.info("There is no endpoints on target server for the following resources")
        for (const iterator of diff) {
            targetLogger.info(iterator.path + '/' + iterator.name)
        }
    }
    let missingApiPaths = new Set(diff.map(e => e.path));

    let sourceNamespaces = await getSourceNamespaces(SOURCE_PROXY);
    let namespacesToCopyFrom = await getCopyFromNamespaces(sourceNamespaces);
    if (namespacesToCopyFrom.length == 0) {
        sourceLogger.info("No namespaces found that match filter criteria: "+NAMESPACES.join(', '))
        sourceLogger.info("Found namespaces : "+ sourceNamespaces.join(', '))
        process.exit(1);
    }
    sourceLogger.info("Resources will be copied from below namespaces:\n" + namespacesToCopyFrom.join(', '))
    await createNamespaces(TARGET_PROXY, namespacesToCopyFrom);

    for (const namespace of namespacesToCopyFrom) {
        //GET SOURCE RESOURCES
        try {

            let resources = await readResourcesFromSource(resourcesToRecreate, namespace, SOURCE_PROXY)
            let resourcesThatCanBeCreated = resources.filter(e => !missingApiPaths.has(e.apiPath));

            await createResourcesOnTarget(resourcesThatCanBeCreated, TARGET_PROXY);

            // for (const iterator of resourcesThatCanBeCreated) {
            //     dumpFile(iterator)
            // }
        } catch (error) {
            logger.error(error);
        }


    }




})();
async function createResourcesOnTarget(resources: ResourceToMove[], url: string, donotdelete:boolean = false) {
    sortAccordingToPriority(resources);
    for (const resource of resources) {
        let resourceLogger = logger.child({name:resource.o.metadata.name, kind: resource.rsName})
        cleanup(resource);

        let pathsResponse = await createResource(url,resource);

        if (pathsResponse.status < 300) {
            resourceLogger.info("Resource created")
        } else if (pathsResponse.status == 409) {
            resourceLogger.info("Resource conflict. Resource exists ")
            resourceLogger.debug(JSON.stringify(await pathsResponse.json()));
            if(donotdelete == false && override){
                resourceLogger.info("Overriding.")
                let response = await deleteResource(url,resource);
                await sleep(5*1000);
                if(response.status == 200 ||response.status  == 202){
                    response = await createResource(url,resource);
                    if(response.status < 203){
                        resourceLogger.info("Resource recreated")
                    }else{
                        resourceLogger.error("Resource was removed, but couldn't be recreated")
                    }
                }else{
                    resourceLogger.error("Resource can't be removed, Try to remove manually")

                }

            }
        }
        else {
            resourceLogger.error("Can not be created")
            resourceLogger.error(pathsResponse.status + pathsResponse.statusText);
            resourceLogger.debug(JSON.stringify(await pathsResponse.json()));
        }
    }
}
function createResource(url:string, resource: ResourceToMove, ){
    let pathsResponse = fetch(url + resource.prefix, {
        method: "POST",
        body: JSON.stringify(resource.o),
        headers: { 'Content-Type': 'application/json' },
    });
    return pathsResponse
}
 
function deleteResource(url:string, resource: ResourceToMove, ){
    let pathsResponse = fetch(url + resource.prefix+"/"+resource.o.metadata.name+"?gracePeriodSeconds=0", {
        method: "DELETE",
        headers: { 'Content-Type': 'application/json' },
    });
    return pathsResponse
}


async function createNamespaces(url: string, namespaces: string[]) {
    let resources = namespaces.map(e => ({
        prefix: "/api/v1/namespaces", 
        ns:e,
        rsName:"namespace",
        apiPath: null, 
        o: {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": e,
            }
        }
    } as ResourceToMove))
    await createResourcesOnTarget(resources, url, true);
}
async function getSourceNamespaces(url: string) {
    let pathsResponse = await fetch(url + '/api/v1/namespaces');
    let json = await pathsResponse.json();
    let namespacesOnTheCluster: string[] = json.items.map((f: { metadata: { name: string; }; }) => f.metadata.name);
    return namespacesOnTheCluster;
}

async function getCopyFromNamespaces(namespacesOnTheCluster: string[]) {
    let regex = NAMESPACES.map(e => new RegExp(e));
    let namespacesToCopyFrom = namespacesOnTheCluster.filter(ns => regex.find(re => re.test(ns)));
    return namespacesToCopyFrom;
}
async function getAvaiableResourcesOnCluster(url: string) {
    let resourcesToRecreate: any[] = [];
    let pathsResponse = await fetch(url);
    let json = await pathsResponse.json();
    for (const path of json.paths) {
        let api = await fetch(url + path)
        if (api.headers.get('content-type') != "application/json") continue;
        let response = await api.json();
        if (!response["resources"]) continue;

        let ableToCopy = response.resources.filter((e: { namespaced: any; verbs: string | string[]; }) => e.namespaced &&
            e.verbs &&
            e.verbs.indexOf("create") > -1 &&
            e.verbs.indexOf("delete") > -1 &&
            e.verbs.indexOf("get") > -1)
            .map((f: { name: any; kind: any; }) => ({
                path: path,
                name: f.name,
                kind: f.kind
            }));
        resourcesToRecreate = [...resourcesToRecreate, ...ableToCopy]
    }
    return resourcesToRecreate;
}
async function readResourcesFromSource(resourcesToRecreate: any[], namespace: string, url: string) {
    let resources :Array<ResourceToMove> = [];

    for (const iterator of resourcesToRecreate) {
        let u = iterator.path + "/namespaces/" + namespace + "/" + iterator.name;
        var localLogger = logger.child({ns: namespace, name: iterator.name});
       
        localLogger.info("Checking " + u)
        let resourceResponse = await fetch(url + u);
        if (resourceResponse.status > 299) {
            localLogger.error("Failed");
            continue;
        }
        let res = await resourceResponse.json();
        if (res.items.length == 0) {
            localLogger.info("No resources");
            continue;
        }

        localLogger.info("Success");
        for (let i = 0; i < res.items.length; i++) {
            let id = res.items[i].metadata.uid;

            if (res.items[i].metadata &&
                res.items[i].metadata["ownerReferences"] &&
                res.items[i].metadata["ownerReferences"].length > 0) {
                    localLogger.info("Object " + res.items[i].metadata["name"] + "is owned, skipping creation")
            } else {
                resources.push({ 
                    prefix: u, 
                    apiPath: iterator.path, 
                    o: res.items[i],
                    ns: namespace,
                    rsName:iterator.name} as ResourceToMove);
            }
        }

    }
    return resources;
}

function dumpFile(iterator: ResourceToMove) {

    let fileName = iterator.prefix.replace(/\//g, '__') + "_" + iterator.o.metadata.uid + ".json";
    fs.writeFileSync("out/" + fileName, JSON.stringify(iterator.o));
}
function sortAccordingToPriority(resources: any[]) {
    let workloads = ['/apis/batch/v1beta1', '/apis/batch/v1', 'apis/apps/v1']
    resources.sort((res1, res2) => {
        let a = workloads.indexOf(res1.apiPath);
        let b = workloads.indexOf(res2.apiPath);
        if (a > b) return 1;
        if (a < b) return -1;
        return 0;
    });
}


function cleanup(obj: ResourceToMove) {
    const resource = obj.o;
    delete resource.metadata.resourceVersion;
    delete resource.metadata.uid;
    delete resource.metadata.creationTimestamp;
    
    try {
        switch(obj.apiPath+'|'+obj.rsName){
            case "/api/v1|services": 
            delete resource.spec.clusterIP; // ADD SWITCH to allow cluster IP settings
            break;
        } 
    } catch (error) {
        
    }

}

interface ResourceToMove{
    prefix: string;
    apiPath: any; 
    o: any;
    ns: string;
    rsName:string;
}

const sleep = (milliseconds:number) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
  }