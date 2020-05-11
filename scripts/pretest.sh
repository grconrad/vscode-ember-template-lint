#!/usr/bin/env bash

# Install dependencies in sample project used by tests.

# This could also be done in the test itself, but it's uglier to run a yarn install from JS
# and adjust timeouts and so on.
echo "Installing dependencies in sample project"
cd ./test-fixtures/sample-project
npm install

cd ../..
