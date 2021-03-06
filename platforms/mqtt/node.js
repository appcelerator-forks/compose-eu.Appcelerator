/*******************************************************************************
Copyright 2015 CREATE-NET
Developed for COMPOSE project (compose-project.eu)

@author Luca Capra <luca.capra@create-net.org>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
******************************************************************************/


var DEBUG = false;
//DEBUG = true;

var d = function(m) { (DEBUG === true || (DEBUG > 19)) && console.log("[mqtt client] " + m); };

var mqtt = require("mqtt");
var parseUrl = require("url").parse;


var parseResponseContent = function(message) {

    var response = {
        type: null,
        meta: {},
        body: {}
    };

    if(!message) {
        return response;
    }

    // parts 0 is header, 1 is body
    var parts = message.split("\n\n");

    var headerparts = parts[0].split("\n");

    // first is type(?), see spec
    response.type = headerparts.shift();

    for (var i in headerparts) {
        var keyval = headerparts[i].match(/^(.+)\:(.*)$/);
        response.meta[keyval[1]] = keyval[2];
    }

    response.body = parts[1] ? JSON.parse(parts[1]) : {};

//    /**
//     * @deprecated Ensure to fix this code once the bridge is stable
//     * */
//    // @TODO see if it is possible to move messageId outside the body
//    if(typeof response.body.messageId !== 'undefined') {
//        response.messageId = response.body.messageId;
//        delete response.body.messageId;
//    }
//    if(message.headers && typeof message.headers.messageId !== 'undefined') {
//        message.messageId = message.headers.messageId;
//    }

    return response;
};

var client;

var adapter = module.exports;
adapter.initialize = function(compose) {

    DEBUG = compose.config.debug;

    var queue = this.queue;

    var host;
    if (compose.config.url) {
        var urlinfo = parseUrl(compose.config.url);
        host = urlinfo.hostname;
    }

    compose.config.mqtt = compose.config.mqtt || {};
    var mqttConf = {
        proto: compose.config.mqtt.secure ? 'mqtts' : 'mqtt',
        host: host || "api.servioticy.com",
        port: compose.config.mqtt.port || "1883",
        user: compose.config.mqtt.user || "compose",
        password: compose.config.mqtt.password || "shines"
    };

    var request = {
        meta: {
            authorization: compose.config.apiKey
        },
        body: {}
    };

    var topics = {
        from: compose.config.apiKey + '/from',
        to: compose.config.apiKey + '/to'

        , stream: function(handler) {
            return "/topic/" + compose.config.apiKey + '/' + handler.container().ServiceObject.id +'/streams/'+ handler.stream.name +'/updates';
        }

    };

    adapter.connect = function(handler, connectionSuccess, connectionFail) {

        d("Connection requested");

        // initialize the client, but only if not connected or reconnecting
        if (!client || (client && !client.connected && (!client.disconnecting && !client.reconnectTimer))) {

            d("Connecting to mqtt server " +
                    mqttConf.proto + "://" + mqttConf.user + ":" + mqttConf.password +
                    "@" + mqttConf.host + ":" + mqttConf.port);

            client = mqtt.createClient(mqttConf.port, mqttConf.host, {
                username: mqttConf.user,
                password: mqttConf.password
            });

            client.on('close', function() {
                d("Connection closed");
                handler.emitter.trigger('close', client);
            });

            client.on('error', function(e) {

                d("Connection error");
                d(e);

                connectionFail(e);
                handler.emitter.trigger('error', e);
            });

            client.on('connect', function() {

                handler.emitter.trigger('connect', client);

                client.subscribe(topics.to, function() {
                    d("Subscribed to " + topics.to);
                    client.on('message', function(topic, message, response) {

                        d("New message from topic " + topic);
                        if(topic === topics.to) {
                            var resp = parseResponseContent(message);
//                            console.log("#### message!", topic, resp);
                            queue.handleResponse(resp);
                        }
                    });

                    // return promise
                    connectionSuccess();

                });
            });
        }
        else {
            // already connected
            connectionSuccess();
        }
    };

    adapter.disconnect = function() {
        queue.clear();
        client.end();
    };

    /*
     * @param {RequestHandler} handler
     */
    adapter.request = function(handler) {

        request.meta.method = handler.method.toUpperCase();
        request.meta.url = handler.path;

        if (handler.body) {
            var body = handler.body;
            if (typeof body === "string") {
                body = JSON.parse(body);
            }
            request.body = body;
        }
        else {
            delete request.body;
        }

        request.meta.messageId = queue.add(handler);

        // 3rd arg has qos option { qos: 0|1|2 }
        // @todo check which one fit better in this case
        d("Sending message..");
        client.publish(topics.from, JSON.stringify(request), { qos: 0 /*, retain: true*/ }, function() {
            d("Message published");
        });

    };

    /*
     * @param {RequestHandler} handler
     */
    adapter.subscribe = function(handler) {

        var topic = topics[ handler.topic ] ? topics[ handler.topic ] : handler.topic;
        if(typeof topic === 'function') {
            topic = topic(handler);
        };

        var uuid = queue.registerSubscription(topic, handler);

        d("[stomp client] Listening to " + topic);

        client.on('message', function(srctopic, message, response) {
            if(topic === srctopic) {
                d("[stomp client] New message from topic " + topic);
                message.messageId = uuid;
                queue.handleResponse(message);
            }
        });

        client.subscribe(topic, function() {
            d('Subscribed');
        });
    };




};

