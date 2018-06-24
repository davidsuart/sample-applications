
// external modules
var objMysql = require('mysql');
const path = require('path');

// --------------------------------------------------
// db tokens
//
var objConnection = objMysql.createConnection({
  host     : '###STRINGREPLACESQLHOST###',
  user     : '###STRINGREPLACESQLUSER###',
  password : '###STRINGREPLACESQLPASS###',
  database : '###STRINGREPLACESQLDATA###',
  multipleStatements: true
});

// --------------------------------------------------
// sql for building the initial schema
//
var sqlCreateTables = "\
SET sql_notes = 0; \
CREATE TABLE IF NOT EXISTS tbl_timestamps ( \
    name varchar(16) NOT NULL UNIQUE, \
    timestamp timestamp, \
    PRIMARY KEY (name) \
); \
INSERT INTO tbl_timestamps (name, timestamp) VALUES ('last_local_get', NULL); \
INSERT INTO tbl_timestamps (name, timestamp) VALUES ('last_local_recv', NULL); \
INSERT INTO tbl_timestamps (name, timestamp) VALUES ('last_fixer_get', NULL); \
INSERT INTO tbl_timestamps (name, timestamp) VALUES ('last_fixer_recv', NULL); \
\
CREATE TABLE IF NOT EXISTS tbl_rates_eur ( \
    curr varchar(3) NOT NULL UNIQUE, \
    rate decimal(16,6), \
    PRIMARY KEY (curr) \
); \
SET sql_notes = 1; \
";
// id int(8) NOT NULL auto_increment, \

// --------------------------------------------------
// sql for cleanup
//
var sqlDropTables = "\
SET FOREIGN_KEY_CHECKS = 0; \
drop table if exists tbl_timestamps; \
drop table if exists tbl_rates_eur; \
SET FOREIGN_KEY_CHECKS = 1; \
";

// --------------------------------------------------
// custom functions for the database operations
//
module.exports =
{
    dbConnect: function (state) {
        objConnection.connect(function(err) {
            if (err) {
                console.error("[ERROR] connection failed: " + err.stack);
                state.db.connected = false;
                return;
            } else {
                state.db.connected = true;
                return;
            }
        });
        objConnection.on("close", function (err) {
            console.log("> caught connection closed.");
            state.db.connected = false;
        });
        objConnection.on("error", function (err) {
            console.error("[ERROR] caught connection error:" +err);
            state.db.connected = false;
        });
    },

    dbCreateTables: function (state) {
        objConnection.query(sqlCreateTables, function (err, result) {
            if (err) throw err;
            console.log("> database connected.");
            state.db.configured = true;
        });
    },

    dbDropTables: function (state) {
        objConnection.query(sqlDropTables, function (err, result) {
            if (err) throw err;
            state.db.configured = false;
        });
    },

    dbQuery: function (cmd, state, callback) {
        objConnection.query(cmd, state, function (err, result) {
            if (err){
                callback(err,null);
            } else {
                callback(null,result);
            }
        });
    },

    dbClose: function (state) {
        objConnection.end(function(err){
            if (err) {
                console.error("[ERROR] error closing database: " + err.stack);
                return;
            } else {
                state.db.connected = false;
            }
        });
    }

};

