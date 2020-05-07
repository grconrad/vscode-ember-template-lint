#!/usr/bin/env bash

set -e

# Install dependencies in sample project used by tests.

# This could also be done in the test itself, but it's a bug uglier to run a yarn install from JS
# and adjust timeouts and so on.
cd src/test/fixtures/sample-project
yarn install