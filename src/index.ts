import fetch from 'node-fetch'
import fs from 'fs'
import minimist from 'minimist';

var argv = minimist(process.argv.slice(2));
console.log(argv)

const SOURCE_PROXY = argv["source"] || "http://localhost:8001";
const TARGET_PROXY = argv["target"] || "http://localhost:8011";
let ns = argv["ns"] || ["example_ns"]
const NAMESPACES = Array.isArray(ns) ? ns : [ns];

console.log(`Starting migration from ${SOURCE_PROXY} to ${TARGET_PROXY}. Namespaces: ${ns}`);

(async function () {

    console.log("Connecting to source")
    let resourcesToRecreate: any[] = await getAvaiableResourcesOnCluster(SOURCE_PROXY);
    console.log("Connecting to target")
    let resourcesOnTarget: any[] = await getAvaiableResourcesOnCluster(TARGET_PROXY);

    let diff = resourcesToRecreate.filter(e => resourcesOnTarget.every(tr => tr.path + tr.name != e.path + e.name));
    if (diff.length > 0) {
        console.log("There is no endpoints on target server for the following resources")
        for (const iterator of diff) {
            console.log(iterator.path + '/' + iterator.name)
        }
    }
    let missingApiPaths = new Set(diff.map(e => e.path));

    let namespacesToCopyFrom = await getSourceNamespaces(SOURCE_PROXY);
    if (namespacesToCopyFrom.length == 0) {
        console.log("No namespaces found that match filter criteria:\n" + namespacesToCopyFrom.join(','))
        process.exit(1);
    }
    console.log("Resources will be copied from below namespaces:\n" + namespacesToCopyFrom.join(','))
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
            console.error(error);
        }


    }




})();
async function createResourcesOnTarget(resources: { prefix: string; apiPath: any; o: any; }[], url: string) {
    sortAccordingToPriority(resources);
    for (const resource of resources) {
        cleanup(resource.o);

        let pathsResponse = await fetch(url + resource.prefix, {
            method: "POST",
            body: JSON.stringify(resource.o),
            headers: { 'Content-Type': 'application/json' },
        });
        if (pathsResponse.status < 300) {
            console.log("Resource created")
        } else if (pathsResponse.status == 409) {
            console.log("Conflict. Resource exists ")
            console.error(await pathsResponse.json());
        }
        else {
            console.error(pathsResponse.status + pathsResponse.statusText);
            console.error(await pathsResponse.json());
        }
    }
}
async function createNamespaces(url: string, namespaces: string[]) {
    let resource = namespaces.map(e => ({
        prefix: "/api/v1/namespaces", apiPath: null, o: {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": e,
            }
        }
    }))
    await createResourcesOnTarget(resource, url);
}
async function getSourceNamespaces(url: string) {
    let pathsResponse = await fetch(url + '/api/v1/namespaces');
    let json = await pathsResponse.json();
    let namespacesOnTheCluster: string[] = json.items.map((f: { metadata: { name: string; }; }) => f.metadata.name);

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
    let resources = [];

    for (const iterator of resourcesToRecreate) {
        let u = iterator.path + "/namespaces/" + namespace + "/" + iterator.name;
        console.log("Checking " + u)
        let resourceResponse = await fetch(url + u);
        if (resourceResponse.status > 299) {
            console.log("Failed");
            continue;
        }
        let res = await resourceResponse.json();
        if (res.items.length == 0) {
            console.log("No resources");
            continue;
        }

        console.log("Success");
        for (let i = 0; i < res.items.length; i++) {
            let id = res.items[i].metadata.uid;

            if (res.items[i].metadata &&
                res.items[i].metadata["ownerReferences"] &&
                res.items[i].metadata["ownerReferences"].length > 0) {
                console.log("Object " + res.items[i].metadata["name"] + "is owned, skipping creation")
            } else {
                resources.push({ prefix: u, apiPath: iterator.path, o: res.items[i] });
            }
        }

    }
    return resources;
}

function dumpFile(iterator: { prefix: string; apiPath: any; o: any; }) {

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


function cleanup(resource: any) {
    delete resource.metadata.resourceVersion;
    delete resource.metadata.uid;
    delete resource.metadata.creationTimestamp;
}

