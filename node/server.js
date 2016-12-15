// Load the http module to create an http server.
var http = require('http');

// something added so we can see which instance we're hitting
var os = require("os");
var hostname = os.hostname();

// Configure our HTTP server to respond with Hello World to all requests.
var server = http.createServer(function (request, response) {
  response.writeHead(200, {"Content-Type": "text/plain"});
  response.write("Hello World\n\n");
  response.end('(Serving from: '+hostname+' !)\n');
});

// Listen on port 8000
server.listen(8000);

// Put a friendly message on the terminal
console.log("Server running");
