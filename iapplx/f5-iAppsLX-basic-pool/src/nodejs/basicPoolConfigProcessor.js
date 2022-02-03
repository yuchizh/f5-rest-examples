/*
  Copyright (c) 2017, F5 Networks, Inc.
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
  *
  http://www.apache.org/licenses/LICENSE-2.0
  *
  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
  either express or implied. See the License for the specific
  language governing permissions and limitations under the License.
*/

'use strict';

// Middleware. May not be installed.
var configTaskUtil = require("./configTaskUtil");
var blockUtil = require("./blockUtils");
var icr = require("./icrTools");

var q = require("q");
var logger = require('f5-logger').getInstance();

var constants = require('./constants');

var nacosTools = require('./nacosTools')

/**
 * A basic config processor for managing LTM pools.
 * Note that the pool member name is not visible in the GUI. It is generated by MCP according to a pattern, we don't want
 * the user setting it
 *
 * @constructor
 */
function BasicPoolConfigProcessor() {
}

BasicPoolConfigProcessor.prototype.setModuleDependencies = function (options) {
    logger.info("setModuleDependencies called");
    configTaskUtil = options.configTaskUtil;
};

BasicPoolConfigProcessor.prototype.WORKER_URI_PATH = "shared/iapp/processors/basicPoolConfig";

BasicPoolConfigProcessor.prototype.onStart = function (success) {
    logger.fine("BasicPoolConfigProcessor.prototype.onStart");
    this.apiStatus = this.API_STATUS.INTERNAL_ONLY;
    this.isPublic = true;

    configTaskUtil.initialize({
        restOperationFactory: this.restOperationFactory,
        eventChannel: this.eventChannel,
        restHelper: this.restHelper
    });

    success();
};


/**
 * Handles initial configuration or changed configuration. Sets the block to 'BOUND' on success
 * or 'ERROR' on failure. The routine is resilient in that it will try its best and always go
 * for the 'replace' all attitude.
 *
 * @param restOperation - originating rest operation that triggered this processor
 */
BasicPoolConfigProcessor.prototype.onPost = function (restOperation) {
    var configTaskState,
        blockState,
        oThis = this;
    logger.fine("BasicPoolConfigProcessor.prototype.onPost");

    var inputProperties;
    try {
        configTaskState = configTaskUtil.getAndValidateConfigTaskState(restOperation);
        blockState = configTaskState.block;
        logger.fine(" inputProperties ", blockState.inputProperties);
        inputProperties = blockUtil.getMapFromPropertiesAndValidate(
            blockState.inputProperties,
            ["poolName", "poolType", "poolMembers", "hostname", "deviceGroupName"]
        );

    } catch (ex) {
        restOperation.fail(ex);
        return;
    }
    // Mark that the request meets all validity checks and tell the originator it was accepted.
    this.completeRequest(restOperation, this.wellKnownPorts.STATUS_ACCEPTED);

    // Generic URI components, minus the 'path'
    var uri = this.restHelper.buildUri({
        protocol: this.wellKnownPorts.DEFAULT_HTTP_SCHEME,
        port: this.wellKnownPorts.DEFAULT_JAVA_SERVER_PORT,
        hostname : "localhost"
    });

    // 取所有的serviceName
    const allServiceNames = await nacosTools.getAllServiceName()
    // 再通过serviceName获取每个serviceName所有节点的ip和端口
    // const serviceInfo = await nacosTools.getServiceInfo(serviceName)

    // In case user requested configuration to deployed to remote
    // device, setup remote hostname, HTTPS port and device group name
    // to be used for identified requests
    icr.configureRemoteDeviceRequests(inputProperties, uri).then(function () {
        // Start by upserting the pool, by name (insert or verify it exists)
        return icr.getExistingPool(restOperation, inputProperties.poolName.value);
    })
    .then(function () {
        logger.fine("BASIC: Add Found a pre-existing pool. Set pool type: " + inputProperties.poolType.value);
        return icr.setPoolType(restOperation, inputProperties.poolName.value, inputProperties.poolType.value);
    }, function (error) {
        logger.fine("BASIC: Add GET of pool failed, adding from scratch, including pool-type");
        return icr.createNewPool(restOperation, inputProperties.poolName.value, inputProperties.poolType.value);
    })
    .then(function() {
        // Get existing pool members
        return icr.getPoolMembers(restOperation, inputProperties.poolName.value);
    })
    .then(function (response) {
        // Delete the existing members (decode from response.body.items list)
        return icr.deletePoolMembers(restOperation, inputProperties.poolName.value, response.body.items);
    })
    .then(function () {
        // Add all required members
        return icr.addPoolMembers(restOperation, inputProperties.poolName.value, inputProperties.poolMembers.value);
    })
    // Final then() to handle setting the block state to BOUND
   .then(function () {
        configTaskUtil.sendPatchToBoundState(configTaskState, 
            oThis.getUri().href, restOperation.getBasicAuthorization());
    })
    // Error handling - Set the block as 'ERROR'
    .catch(function (error) {
        logger.fine("BASIC: Add Failure: adding/modifying a pool: " + error.message);
        configTaskUtil.sendPatchToErrorState(configTaskState, error,
            oThis.getUri().href, restOperation.getBasicAuthorization());
    })
    // Always called, no matter the disposition. Also handles re-throwing internal exceptions.
    .done(function () {
        logger.fine("BASIC: Add DONE!!!");
    });
};

/**
 * Handles DELETE. The configuration must be removed, if it exists. Patch the block to 'UNBOUND' or 'ERROR'
 *
 * @param restOperation - originating rest operation that triggered this processor
 */
BasicPoolConfigProcessor.prototype.onDelete = function (restOperation) {
    var configTaskState,
        blockState;
    var oThis = this;

    logger.fine("BasicPoolConfigProcessor.prototype.onDelete");

    var inputProperties;
    try {
        configTaskState = configTaskUtil.getAndValidateConfigTaskState(restOperation);
        blockState = configTaskState.block;
        inputProperties = blockUtil.getMapFromPropertiesAndValidate(blockState.inputProperties,
            ["poolName", "poolType", "poolMembers"]);
    } catch (ex) {
        restOperation.fail(ex);
        return;
    }
    this.completeRequest(restOperation, this.wellKnownPorts.STATUS_ACCEPTED);

    // Generic URI components, minus the 'path'
    var uri = this.restHelper.buildUri({
        protocol: this.wellKnownPorts.DEFAULT_HTTP_SCHEME,
        port: this.wellKnownPorts.DEFAULT_JAVA_SERVER_PORT,
        hostname: "localhost"
    });

    // In case user requested configuration to deployed to remote
    // device, setup remote hostname, HTTPS port and device group name
    // to be used for identified requests
    icr.configureRemoteDeviceRequests(inputProperties, uri)
        .then(function () {
            // Check to see if the pool exists, if so, delete, if not, done and happy.
            return icr.getExistingPool(restOperation, inputProperties.poolName.value);
        })
        .then(function () {
            logger.fine("BASIC: delete Found a pre-existing pool. Full Config Delete");
            return icr.deleteExistingPool(restOperation, inputProperties.poolName.value)
                .then (function (response) {
                    logger.fine("BASIC: delete The pool is all removed");
                    configTaskUtil.sendPatchToUnBoundState(configTaskState,
                        oThis.getUri().href, restOperation.getBasicAuthorization());
                });
        }, function (error) {
            // the configuration must be clean. Nothing to delete
            configTaskUtil.sendPatchToUnBoundState(configTaskState, 
                oThis.getUri().href, restOperation.getBasicAuthorization());
        })
        // Error handling - Set the block as 'ERROR'
        .catch(function (error) {
            logger.fine("BASIC: Delete failed, setting block to ERROR: " + error.message);
            configTaskUtil.sendPatchToErrorState(configTaskState, error,
                oThis.getUri().href, restOperation.getBasicAuthorization());
        })
        // Always called, no matter the disposition. Also handles re-throwing internal exceptions.
        .done(function () {
            logger.fine("BASIC: delete DONE!!!");  // happens regardless of errors or no errors ....
        });
};

module.exports = BasicPoolConfigProcessor;
