var redis = require("redis");
var http = require("http");
var MG = require("./my_globals").C;
var url = require('url');
var rcli = redis.createClient(redis.DEFAULT_PORT, '10.95.8.182');
function do_job(task) {
    var target_host = task.headers[MG.HEAD_RELAYER_HOST];
    if (!target_host) {
        console.log("Not target host");
    }
    else {
        var options = url.parse(target_host);
        task.headers['host'] = options.host;
        options.headers = task.headers;
        req = http.request(options, function (rly_res) {
                get_response(rly_res, task, function (task, resp_obj) {
                    //PERSISTENCE
                    if (task.headers[MG.HEAD_RELAYER_PERSISTENCE]) {
                        set_object(task, resp_obj, task.headers[MG.HEAD_RELAYER_PERSISTENCE]);
                    }

                    //CALLBACK
                    var callback_host = task.headers[MG.HEAD_RELAYER_HTTPCALLBACK];
                    var db_err;
                    if (callback_host) {
                        var callback_options = url.parse(callback_host);
                        callback_options.method = 'POST';
                        var callback_req = http.request(callback_options, function(callback_res) {
                                //check callback_res status (modify state) Not interested in body
                                db_err = {callback_status : callback_res.statusCode, details:'callback sent OK'};
                                //TODO DAO don't use REDIS at this level
                                rcli.hmset("wrH:" + task.id, db_err, function (err, red_res) {
                                    if (err) {
                                        console.log("BD Error setting callback status:" + err);
                                    }
                                });
                            }
                        );
                        
                        callback_req.on('error', function(err) {
                            //error in request
                            var str_err = JSON.stringify(err);
                            db_err = {callback_status:'error', details: str_err};
                            //store
                            //TODO DAO don't use REDIS at this level
                            rcli.hmset("wrH:" + task.id, db_err, function (err, red_res) {
                                if (err) {
                                    console.log("BD Error setting callback ERROR:" + err);
                                }
                            });
                        });
                        var str_resp_obj = JSON.stringify(resp_obj);
                        callback_req.write(str_resp_obj);
                        callback_req.end();
                    } //CALLBACK end
                    
                });
            }
        );
        req.on('error', function (e) {
            console.log('problem with request: ' + e.message);
        });
        req.end();
    }
}

function get_response(resp, task, callback) {
    var data = "";
    resp.on('data', function (chunk) {
        data += chunk;
    });
    resp.on('end', function (chunk) {
        if (chunk) {
            if(chunk){
                data += chunk;
            } //avoid tail undefined
        }
        var headers_str = JSON.stringify(resp.headers);
        var resp_obj = {statusCode:resp.statusCode, headers:headers_str, body:data, state:'relay_response'};
        if (callback) {
            callback(task, resp_obj);
        }
    });
}
function set_object(task, resp_obj, type) {
    //TODO refactorize (be carefull, resp_obj Mutable)
    //remove from response what is not needed
    type = type.toUpperCase();
    if (type === 'STATUS') {
        delete resp_obj.body;
        delete resp_obj.headers;
    }
    else if (type == 'HEADER') {
        delete resp_obj.body;
    }
    else if (type == 'BODY') {
        //nothing to do?
    }
    else {
        //Error
        console.log(type + " is not a valid value for " + MG.HEAD_RELAYER_PERSISTENCE);
        return;
    }
    //TODO DAO don't use REDIS at this level
    rcli.hmset("wrH:" + task.id, resp_obj, function (err, red_res) {
        if (err) {
            console.log(err);
        }
        else {
            console.log(red_res);
        }
    });
}
exports.do_job = do_job;
