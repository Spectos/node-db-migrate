var fs = require('fs');
var path = require('path');
var config = require('./config');
var log = require('./log');
var Skeleton = require('./skeleton');

var filesRegEx = /\.js$/;
var coffeeSupported = false;
var coffeeModule = null;
try {
  coffeeModule = require('coffee-script');
  if (coffeeModule && coffeeModule.register) coffeeModule.register();
  coffeeSupported = true;
  filesRegEx = /\.(js|coffee)$/;
} catch (e) {}

var internals = {};

function writeMigrationRecord(db, migration, callback) {
  db._runSql('INSERT INTO ' + internals.migrationTable + ' (name, run_on) VALUES (?, ?)', [migration.name, new Date()], callback);
}

var Migration = Skeleton.extend({

    init: function() {
    if (arguments.length >= 3) {
      this.title = arguments[0];
      this.date = arguments[2];
      this.name = this.formatName(this.title, this.date);
      this.path = this.formatPath(arguments[1], this.name);
      this.templateType = arguments[3];
      internals = arguments[4];
    } else if (arguments.length == 2) {
      this.path = arguments[0];
      this.name = this.parseName(this.path);
      this.date = this.parseDate(this.name);
      this.title = this.parseTitle(this.name);
      internals = arguments[1];
    }

    this._super(internals);
  }
});

Migration.prototype.defaultCoffeeTemplate = function() {
  return [
    "dbm = undefined",
    "type = undefined",
    "",
    "exports.setup = (options) ->",
    "  dbm = options.dbmigrate;",
    "  type = dbm.dataType;",
    "  return",
    "",
    "exports.up = (db, callback) ->",
    "",
    "",
    "exports.down = (db, callback) ->",
    "",
    "",
    ""
  ].join("\n");
};

Migration.prototype.defaultJsTemplate = function() {
  return [
    "var dbm;",
    "var type;",
    "",
    "/**",
    "  * We receive the dbmigrate dependency from dbmigrate initially.",
    "  * This enables us to not have to rely on NODE_PATH.",
    "  */",
    "exports.setup = function(options) {",
    "  dbm = options.dbmigrate;",
    "  type = dbm.dataType;",
    "};",
    "",
    "exports.up = function(db, callback) {",
    "  callback();",
    "};",
    "",
    "exports.down = function(db, callback) {",
    "  callback();",
    "};",
    ""
  ].join("\n");
};

Migration.prototype.defaultSqlTemplate = function() {
  return "/* Replace with your SQL commands */";
};


Migration.prototype.sqlFileLoaderTemplate = function() {
  return [
    "var dbm;",
    "var type;",
    "var fs = require('fs');",
    "var path = require('path');",
    "",
    "/**",
    "  * We receive the dbmigrate dependency from dbmigrate initially.",
    "  * This enables us to not have to rely on NODE_PATH.",
    "  */",
    "exports.setup = function(options) {",
    "  dbm = options.dbmigrate;",
    "  type = dbm.dataType;",
    "};",
    "",
    "exports.up = function(db, callback) {",
    "  var filePath = path.join(__dirname + '/sqls/"+this.name.replace('.js', '')+"-up.sql');",
    "  fs.readFile(filePath, {encoding: 'utf-8'}, function(err,data){",
    "    if (err) return callback(err);",
    "      console.log('received data: ' + data);",
    "",
    "    db.runSql(data, function(err) {",
    "      if (err) return callback(err);",
    "      callback();",
    "    });",
    "  });",
    "};",
    "",
    "exports.down = function(db, callback) {",
    "  var filePath = path.join(__dirname + '/sqls/"+this.name.replace('.js', '')+"-down.sql');",
    "  fs.readFile(filePath, {encoding: 'utf-8'}, function(err,data){",
    "    if (err) return callback(err);",
    "      console.log('received data: ' + data);",
    "",
    "    db.runSql(data, function(err) {",
    "      if (err) return callback(err);",
    "      callback();",
    "    });",
    "  });",
    "};",
    ""
  ].join("\n");
};

Migration.TemplateType = {
  DEFAULT_JS: 0,
  DEFAULT_SQL: 1,
  SQL_FILE_LOADER: 2,
  DEFAULT_COFFEE: 3
};

Migration.prototype.getTemplate = function() {
  switch (this.templateType) {
    case Migration.TemplateType.DEFAULT_SQL:
      return this.defaultSqlTemplate();
    case Migration.TemplateType.SQL_FILE_LOADER:
      return this.sqlFileLoaderTemplate();
    case Migration.TemplateType.DEFAULT_COFFEE:
      return this.defaultCoffeeTemplate();
    case Migration.TemplateType.DEFAULT_JS:
    default:
      return this.defaultJsTemplate();
  }
};

Migration.prototype.write = function(callback) {
  fs.writeFile(this.path, this.getTemplate(), callback);
};

Migration.loadFromFilesystem = function(dir, callback) {
  log.verbose('loading migrations from dir', dir);
  fs.readdir(dir, function(err, files) {
    if (err) { callback(err); return; }
    var coffeeWarn = true;
    files = files.filter(function(file) {
      if (coffeeWarn && !coffeeSupported && /\.coffee$/.test(file)) {
        log.warn('CoffeeScript not installed');
        coffeeWarn = false;
      }
      return filesRegEx.test(file);
    });
    var migrations = files.sort().map(function(file) {
      return new Migration(path.join(dir, file), internals);
    });
    callback(null, migrations);
  });
};

Migration.loadFromDatabase = function(dir, driver, callback) {
  log.verbose('loading migrations from database');
  driver.allLoadedMigrations(function(err, dbResults) {
    if (err && !internals.dryRun) { callback(err); return; }
    else if (err && internals.dryRun) {
      dbResults = []
    }
    var migrations = dbResults.filter(function(result) {
      return result.name.substr(0,result.name.lastIndexOf('/')) === internals.matching;
    }).map(function(result) {
      return new Migration(path.join(dir, result.name), internals);
    });

    callback(null, migrations);
  });
};

Migration.exportInternals = function(intern) {

  internals = intern;
}

module.exports = Migration;
