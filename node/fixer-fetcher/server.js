
// say something nice
console.log("> app starting");

// show some more details
Error.stackTraceLimit = 20;

// Include external modules
var http = require("http");
const moment = require('moment');
const host = require("os");
const util = require('util')
const path = require('path');
const Fixer = require('fixer-node')

// require custom mysql
var mysql = require('./mysql.js');

// safety check
var self = this;

// --------------------------------------------------
// a container to store some state
//
var stateObject = function () {
    this.data = {
        ratelist: null,
        unreliable: null,
        last_error: null,
    }
    this.db = {
            connected: false,
            configured: false,
            dead_wait_count: 0,
        }
    this.timestamps = {
            last_local_get: null,
            last_local_recv: null,
            last_fixer_get: null,
            last_fixer_recv: null,
        }
};
stateObject.prototype.dumpDataToConsole = function () {
    console.log("> stateObject: \n " + JSON.stringify(this, null, 2));
};

// --------------------------------------------------
// connect to db
//
fnConnectDatabase = function(state, mysql) {
    this.tmp = mysql.dbConnect(state);
}

// --------------------------------------------------
// drop the database
//
fnDropDatabase = function(state, mysql) {
    // console.log("> hazing the database ...");
    var dbAction = mysql.dbDropTables(state);
}

// --------------------------------------------------
// ensure our DB is connected and our schema is built
//
fnValidateDatabase = function(state, mysql) {

    if (!(typeof(state.db.connected) === 'undefined') && (state.db.connected === true)) {
        // flush dead_wait_count
        state.db.dead_wait_count = 0
        // Has it been built?
        if (!(typeof(state.db.configured) === 'undefined') && (state.db.configured === true)) {
            // Good. Nothing to see here.
        } else {
            // build it
            mysql.dbCreateTables(state);
        }
    } else {
        // mysql callback might not have completed yet ...
        state.db.dead_wait_count++
        if ( state.db.dead_wait_count >= 5) {
            // die screaming if the db is not accessible by now (5 minutes)
            console.error("[ERROR] Database is not connected after ["+state.db.dead_wait_count+"] attempts.");
            process.exit(1);
        }
    }
}

// --------------------------------------------------
// standardised timestamping process
//
fnUpdateTimestamp = async function(state, timestamp, mysql) {
    if ((typeof(state.db.configured) === 'undefined') || (state.db.configured === false)) { return; }

    // update timestamp
    var strSQL = "INSERT INTO tbl_timestamps (name, timestamp) VALUES ('"+timestamp.toString()+"', '"+moment().utc()+"') ON DUPLICATE KEY UPDATE name = VALUES(name), timestamp = VALUES(timestamp)"
    mysql.dbQuery(strSQL, state, function(err,results){
        if (err) { console.error("[ERROR] from dbQuery: ",err); }
    });
    state.timestamps[timestamp.toString()] = moment().utc();
}

// --------------------------------------------------
// getting the rates from the fixer api
//
fnGetFixerRates = async function(state, fixer, mysql) {

    if ((typeof(state.db.configured) === 'undefined') || (state.db.configured === false)) { return; }

    fnUpdateTimestamp(state, 'last_fixer_get', mysql)

    try {
        // get rates
        const base = await fixer.base({ base: 'EUR' }) // Optional: symbols: 'USD, GBP, ETC'

        // console.log("> Ermagherd, got some rates!");
        fnUpdateTimestamp(state, 'last_fixer_recv', mysql)

        state.data.unreliable = false;

        // Just grasp the rates only
        const obj = JSON.parse(JSON.stringify(base.rates))
        Object.entries(obj).map(([key, value]) => {

            // store in the db
            var strSQL = "INSERT INTO tbl_rates_eur (curr, rate) VALUES ('"+key+"', '"+value+"') ON DUPLICATE KEY UPDATE curr = VALUES(curr), rate = VALUES(rate)"
            mysql.dbQuery(strSQL, state, function(err,results){
                if (err) { console.error("[ERROR] from dbQuery: ",err); }
            });
        });

        fnUpdateTimestamp(state, 'last_local_recv', mysql)

    } catch (err) {
        // err.info is the same as err.message,
        // e.g. "Your monthly API request volume has been reached. Please upgrade your plan"
        const info = err.info

        // err.code the fixer.io API code,
        // e.g. "201" which represents "An invalid base currency has been entered."
        const code = err.code

        var tmpError;
        tmpError = "[err.code:"+err.code+"] [err.info:"+err.info+"]";
        if (err.code === 101) { tmpError = "Your monthly usage limit has been reached.\n         Please upgrade your Subscription Plan." }

        state.data.last_error = tmpError;
        state.data.unreliable = true;
    }

}

// --------------------------------------------------
// Initiate a pull of data from our local database
//
fnLoadLocalData = function(state, mysql) {

    if ((typeof(state.db.configured) === 'undefined') || (state.db.configured === false)) { return; }

    fnUpdateTimestamp(state, 'last_local_get', mysql)

    var strSQL = "SELECT * FROM tbl_rates_eur;";

    var getTheMoney = mysql.dbQuery(strSQL, state, function(err,results){
        if (err) {
            console.error("[ERROR] from dbQuery: ",err);
            return; // undefined
        } else {
            var tmpStr = ""
            tmpStr = "--[ EUR rates ]------------------------------------- \n\n";
            for (var i in results) {
                tmpStr = tmpStr + "  " + results[i].curr + " | " + results[i].rate + " \n"
            }
            state.data.ratelist = tmpStr.toString();
            fnUpdateTimestamp(state, 'last_local_recv', mysql)
        }
        return; // inner query
    });
    return; // outer fn
}

// --------------------------------------------------
// start a server for http requests
//
var fnLaunchServer = function(state) {

    var objServer = http.createServer(function (request, response) {

        response.writeHead(200, {
            'Content-Type': 'text/plain'
        });

        // caller to load the dataset into state
        //
        var showTheMoney = fnLoadLocalData(state, mysql, function(err,rates){ });

        // check that our data is valid (It isn't on the first run) and print it
        //
        if (!(typeof(state.data.ratelist) === 'undefined') && !(state.data.ratelist === null) ) {

            if (!(typeof(state.data.unreliable) === 'undefined') && (state.data.unreliable === true) ) {
                // something is awry with the data, add a warning at the start
                this.tmpWarning = ""
                response.write("--[ WARNING ]--------------------------------------- \n\n");
                response.write("WARNING: This data may be out of date.\n\n");
                response.write("Reason:  " + state.data.last_error.toString() + " \n");
                response.write("\n");
            }

            // print our most recently fetched rates
            response.write(state.data.ratelist.toString()+"\n\n");
        } else {
            response.write("No data currently available, please wait a moment ..." + "\n\n");
        }

        // A footer of debug information
        //
        response.write("\n");
        response.write("--[ timestamps ]------------------------------------ \n");
        response.write("fixer data last received:  (UTC) " + moment.utc(state.timestamps.last_fixer_recv).format('HH:mm:ss DD/MM/YYYY') + "\n");
        response.write("loaded from local DB:      (UTC) " + moment.utc(state.timestamps.last_local_get).format('HH:mm:ss DD/MM/YYYY') + "\n");

        // coded but not used in the final output:
        //
        // ("Page executed at:          (UTC) " + moment().utc().format('HH:mm:ss DD/MM/YYYY') + "\n");
        // ("fixer data last fetched:   (UTC) " + moment.utc(state.timestamps.last_fixer_get) + "\n");
        // ("fixer data received at:    (UTC) " + moment.utc(state.timestamps.last_fixer_recv) + "\n");
        // ("written to local DB at:    (UTC) " + moment.utc(state.timestamps.last_local_recv) + "\n");

        response.write("\n");
        response.write("--[ debug ]----------------------------------------- \n");
        response.write('Serving from node: '+host.platform()+'/'+host.hostname()+' \n');

        // Signoff
        response.end('\n');
    })

    // Listen on port 8000
    objServer.listen(8000);
}

// --------------------------------------------------
// the "main"
//
var fnDoItDoItNow = function() {

    // build our state container
    var state = new stateObject();

    // get a fixer instance
    const fixer = new Fixer('###STRINGREPLACEAPIKEY###');
    
    // connect the db
    fnConnectDatabase(state, mysql);

    // burn down the database at every startup
    fnDropDatabase(state, mysql);

    // and re-build it fresh
    fnValidateDatabase(state, mysql);

    // recurring database connectivity check @ 60 seconds
    var rptDatabaseHealthCheck = setInterval(function(state, mysql) { fnValidateDatabase(state, mysql) }, 60000, state, mysql);

    // recurring rate fetcher @ 5 mins
    var rptRateGetter = setInterval(function(state, fixer, mysql) { fnGetFixerRates(state, fixer, mysql) }, 300000, state, fixer, mysql);

    // our http listener
    fnLaunchServer(state);

    // initial gets to bootstrap data loading
    this.setTimeout(function(){ fnValidateDatabase(state, mysql); }, 5000);
    this.setTimeout(function(){ fnGetFixerRates(state, fixer, mysql); }, 7500);

    // sign off
    console.log("> app running");

}
fnDoItDoItNow()
