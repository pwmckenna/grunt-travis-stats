'use strict';

var assert = require('assert');
var q = require('q');
var inquirer = require('inquirer');
var _ = require('lodash');
var colors = require('colors');
var moment = require('moment');
var Travis = require('travis-ci');

module.exports = function (grunt) {
    grunt.registerTask('travis-stats', function () {
        var done = this.async();

        var pkg = grunt.file.readJSON('package.json');
        var gitRepoRegex = /git:\/\/github.com\/(.*)\/(.*).git/;
        var httpRepoRegex = /https:\/\/github.com\/(.*)\/(.*).git/;

        var repoMatch;
        if (_.isString(pkg.repository)) {
            repoMatch = pkg.repository.match(gitRepoRegex) || pkg.repository.match(httpRepoRegex);
        } else if (_.isObject(pkg.repository) && pkg.repository.type === 'git' && pkg.repository.hasOwnProperty('url')) {
            repoMatch = pkg.repository.url.match(gitRepoRegex) || pkg.repository.url.match(httpRepoRegex);
        }
        if (!repoMatch) {
            return grunt.log.fail('Can not determine github repository owner/name');
        }
        var owner = repoMatch[1];
        var repo = repoMatch[2];

        q.resolve().then(function () {
            var defer = q.defer();
            inquirer.prompt([{
                type: 'confirm',
                name: 'pro',
                message: 'Is this a private repo using Travis Pro?',
                default: false
            }], function (answers) {
                defer.resolve(answers.pro);
            });
            return defer.promise;
        }).then(function (pro) {
            if (pro) {
                return q.resolve().then(function () {
                    var defer = q.defer();
                    inquirer.prompt([{
                        type: 'input',
                        name: 'username',
                        message: 'Github Username'
                    }, {
                        type: 'password',
                        name: 'password',
                        message: 'Github Password'
                    }], function (answers) {
                        defer.resolve(answers);
                    });
                    return defer.promise;
                }).then(function (credentials) {
                    var defer = q.defer();
                    var travis = new Travis({
                        version: '2.0.0',
                        pro: true
                    });
                    travis.authenticate({
                        username: credentials.username,
                        password: credentials.password
                    }, defer.makeNodeResolver());
                    return defer.promise.thenResolve(travis);
                });
            } else {
                return new Travis({
                    version: '2.0.0'
                });
            }
        }).then(function (travis) {
            var scaleBuildDuration = function (duration) {
                return Math.floor(duration / 30);
            };

            var printBuilds = function (builds) {
                var passedBuilds = _.where(builds, {
                    state: 'passed'
                });

                var min = scaleBuildDuration(_.min(passedBuilds, function (build) {
                    return scaleBuildDuration(build.duration);
                }).duration);
                var max = scaleBuildDuration(_.max(passedBuilds, function (build) {
                    return scaleBuildDuration(build.duration);
                }).duration);
                var avg = Math.floor(_.reduce(passedBuilds, function (memo, build) {
                    return memo + scaleBuildDuration(build.duration);
                }, 0) / passedBuilds.length);

                var msg = new Array(min + 1).join(' ').underline.blue
                    + new Array(avg - min + 1).join(' ').underline.white
                    + new Array(max - avg + 1).join(' ').underline.red;
                grunt.log.write('\n' + msg);


                for (var i = 0; i < passedBuilds.length; ++i) {
                    var build = passedBuilds[i];
                    var scaled = scaleBuildDuration(build.duration);

                    var msg = new Array(min + 1).join('.').blue
                        + new Array(scaled - min + 1).join('.').white
                        + new Array(max - scaled + 1).join('.').red;
                    grunt.log.write('\n' + msg);
                    grunt.log.write('\t' + moment.duration(build.duration, 'seconds').humanize());
                    grunt.log.write('\t' + moment(build.started_at).fromNow());
                }
                var msg = new Array(min + 1).join(' ').underline.blue
                    + new Array(avg - min + 1).join(' ').underline.white
                    + new Array(max - avg + 1).join(' ').underline.red;
                grunt.log.write('\n' + msg);
                grunt.log.write('\n');
            };

            var getBuilds = function (iterationsLeft, afterNumber) {
                grunt.log.write('.');
                var defer = q.defer();
                travis.repos(owner, repo).builds.get({
                    after_number: afterNumber,
                    state: 'passed'
                }, defer.makeNodeResolver());
                --iterationsLeft;
                return (iterationsLeft > 0) ? defer.promise.then(function (res) {
                    return getBuilds(iterationsLeft, _.last(res.builds).number).then(function (builds) {
                        return res.builds.concat(builds);
                    });
                }) : defer.promise.then(function (res) {
                    return res.builds;
                });
            };

            return getBuilds(30).then(printBuilds);
        }).nodeify(done);
    });
};