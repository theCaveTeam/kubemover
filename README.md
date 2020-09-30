# Move kubernetes workload between clusters.

## Run locally 
Run ``` kubectl proxy --context source-cluster-context ```
Run ``` kubectl proxy --port 8011 --context destination-cluster-context ```

Run the script.

tsc && node /dist/index.js  cluster123-d cluster456 --ns sg-test

## Run as docker 

Run as a docker container

``` docker run -v {path to kubeconfig file}:/cfg/config thecaveteam/kubemover  -s {source context} -d {destination context} --ns {namespace} ``` 

Examples:

``` 
docker run -v ~/.kube/config:/cfg/config thecaveteam/kubemover  -s cluster123 -d cluster456 --ns mynamespace 

docker run -v ~/.kube/config:/cfg/config thecaveteam/kubemover  -s cluster123 -d cluster456 --ns mynamespace --ns mynamespace2

docker run -v ~/.kube/config:/cfg/config thecaveteam/kubemover  -s cluster123 -d cluster456 --ns mynames*

``` 

## E2E Tests
The easies way to test is to use [KIND](https://kind.sigs.k8s.io/) cluster. 
```

kind create cluster  --kubeconfig config --name source-cluster
kind create cluster  --kubeconfig config --name target-cluster

kubectl create ns test1234 --context kind-source-cluster --kubeconfig config
kubectl run nginx --image=nginx --replicas=1 -n test1234 --context kind-source-cluster --kubeconfig config


docker run --network=host -v $(pwd)/config:/cfg/config thecaveteam/kubemover  -s kind-source-cluster -d kind-target-cluster --ns test1234

kubectl get pods -n test1234 --context kind-target-cluster --kubeconfig config 

kind delete cluster --name target-cluster
kind delete cluster --name source-cluster


```

## Contributing

Please read [CONTRIBUTING.md](https://github.com/theCaveTeam/kubemover/blob/master/.github/CONTRIBUTING.md) for details.
