#!/bin/bash

# run codex in a container with access to the youtube HTML

docker build . -t codex

docker run -v ./pages:/pages -v ${HOME}/.codex/:/root/.codex -it codex bash
