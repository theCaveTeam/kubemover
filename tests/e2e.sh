kind create cluster  --kubeconfig config --name source-cluster
kind create cluster  --kubeconfig config --name target-cluster


kubectl create ns test1234 --context kind-source-cluster --kubeconfig config
kubectl run nginx --image=nginx --replicas=1 -n test1234 --context kind-source-cluster --kubeconfig config

docker run --network=host -v $(pwd)/config:/cfg/config gr4b4z/kubemover  -s kind-source-cluster -d kind-target-cluster --ns test1234

kubectl get pods -n test1234 --context kind-target-cluster --kubeconfig config 

kind delete cluster --name target-cluster
kind delete cluster --name source-cluster

