FROM node:latest
RUN curl -LO "https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
RUN chmod +x ./kubectl &&  mv ./kubectl /usr/local/bin/kubectl
RUN npm  install -g typescript
ENV KUBECONFIG=/cfg/config
WORKDIR /app
COPY . /app
RUN npm install && tsc
ENTRYPOINT ["node","start.js"]
