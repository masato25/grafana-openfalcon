///<reference path="../../../headers/common.d.ts" />
System.register(['lodash', 'app/core/utils/datemath'], function(exports_1) {
    var lodash_1, dateMath;
    /** fixed openfalcon query **/
    function FixTargets(targets) {
      return _.map(targets, function(obj){
        if( obj.target && obj.target != "" && obj.target.match(/\./) ){
            obj.target = obj.target.replace(/\./g, "#");
            //fix ip back to the right foramt ex. 10#10#10#10 -> 10.10.10.10
            obj.target = obj.target.replace(/(\d+)#(\d+)#(\d+)#(\d+)/g,"$1.$2.$3.$4");
        }
        return obj;
      })
    }
    /** @ngInject */
    function OpenfalconDatasource(instanceSettings, $q, backendSrv, templateSrv) {
        this.basicAuth = instanceSettings.basicAuth;
        this.url = instanceSettings.url;
        this.name = instanceSettings.name;
        this.cacheTimeout = instanceSettings.cacheTimeout;
        this.withCredentials = instanceSettings.withCredentials;
        this.render_method = instanceSettings.render_method || 'POST';
        this.query = function (options) {
            console.log("opt", templateSrv)
            var mytarget = FixTargets(options.targets)
            var graphOptions = {
                from: this.translateTime(options.rangeRaw.from, false),
                until: this.translateTime(options.rangeRaw.to, true),
                targets: mytarget,
                format: options.format,
                cacheTimeout: options.cacheTimeout || this.cacheTimeout,
                maxDataPoints: options.maxDataPoints,
            };
            console.log("graphOptions", graphOptions)
            var params_tmp = this.buildOpenfalconParams(graphOptions, options.scopedVars);
            var params = params_tmp[0]
            graphOptions.targets = params_tmp[1]
            if (params.length === 0) {
                return $q.when({ data: [] });
            }
            if (options.format === 'png') {
                return $q.when(this.url + '/render' + '?' + params.join('&'));
            }
            var httpOptions = { method: this.render_method, url: '/render' };
            if (httpOptions.method === 'GET') {
                httpOptions.url = httpOptions.url + '?' + params.join('&');
            }
            else {
                // httpOptions.data = params.join('&');
                httpOptions.data = graphOptions;
                httpOptions.headers = { 'Content-Type': 'application/json' };
            }
            return this.doOpenfalconRequest(httpOptions).then(this.convertDataPointsToMs);
        };
        this.convertDataPointsToMs = function (result) {
            if (!result || !result.data || !result.data.length) {
                return [];
            }
            var data = [], datapoints = [], timestamp = 0,
                value = 0, values = [], metric = '', host = '';
            _.forEach(result.data, function(row) {
                if ('Values' in row) {
                     values = row.Values;
                     metric = row.counter;
                     host = row.endpoint;
                     datapoints = [];
                     _.forEach(values, function(arr) {
                            timestamp = arr['timestamp'];
                            value = arr['value'];
                            datapoints.push([value, timestamp]);
                     });
                     obj = {};
                     obj.datapoints = datapoints;
                     obj.target = host + '.' + metric;
                     data.push(obj);
                }
            });
            result.data = data;
            if (!result || !result.data) { return []; }
            for (var i = 0; i < result.data.length; i++) {
                var series = result.data[i];
                for (var y = 0; y < series.datapoints.length; y++) {
                    series.datapoints[y][1] *= 1000;
                }
            }
            return result;
        };
        this.annotationQuery = function (options) {
            // Openfalcon metric as annotation
            if (options.annotation.target) {
                var target = templateSrv.replace(options.annotation.target, {}, 'glob');
                console.log("ann opt", options)
                var openfalconQuery = {
                    rangeRaw: options.rangeRaw,
                    targets: [{ target: target }],
                    format: 'json',
                    maxDataPoints: 100
                };
                console.log("openfalconQuery", openfalconQuery)
                return this.query(openfalconQuery).then(function (result) {
                    var list = [];
                    for (var i = 0; i < result.data.length; i++) {
                        var target = result.data[i];
                        for (var y = 0; y < target.datapoints.length; y++) {
                            var datapoint = target.datapoints[y];
                            if (!datapoint[0]) {
                                continue;
                            }
                            list.push({
                                annotation: options.annotation,
                                time: datapoint[1],
                                title: target.target
                            });
                        }
                    }
                    return list;
                });
            }
            else {
                // Openfalcon event as annotation
                var tags = templateSrv.replace(options.annotation.tags);
                console.log("openfalconQuery-tag", tags)
                return this.events({ range: options.rangeRaw, tags: tags }).then(function (results) {
                    var list = [];
                    for (var i = 0; i < results.data.length; i++) {
                        var e = results.data[i];
                        list.push({
                            annotation: options.annotation,
                            time: e.when * 1000,
                            title: e.what,
                            tags: e.tags,
                            text: e.data
                        });
                    }
                    return list;
                });
            }
        };
        this.events = function (options) {
            try {
                var tags = '';
                if (options.tags) {
                    tags = '&tags=' + options.tags;
                }
                return this.doOpenfalconRequest({
                    method: 'GET',
                    url: '/events/get_data?from=' + this.translateTime(options.range.from, false) +
                        '&until=' + this.translateTime(options.range.to, true) + tags,
                });
            }
            catch (err) {
                return $q.reject(err);
            }
        };
        this.translateTime = function (date, roundUp) {
            if (lodash_1.default.isString(date)) {
                if (date === 'now') {
                    return Math.ceil((new Date).getTime()/1000);
                }
                else if(date.match(/(\d+)h/).length != 0){
                    var current = Math.ceil((new Date).getTime()/1000);
                    return current - (+date.match(/(\d+)h/)[1] * 60 * 60);
                }
                else if (date.indexOf('now-') >= 0 && date.indexOf('/') === -1) {
                    date = date.substring(3);
                    date = date.replace('m', 'min');
                    date = date.replace('M', 'mon');
                    return date;
                }
                date = dateMath.parse(date, roundUp);
            }
            // openfalcon' s from filter is exclusive
            // here we step back one minute in order
            // to guarantee that we get all the data that
            // exists for the specified range
            if (roundUp) {
                if (date.get('s')) {
                    date.add(1, 'm');
                }
            }
            else if (roundUp === false) {
                if (date.get('s')) {
                    date.subtract(1, 'm');
                }
            }
            return date.unix();
        };
        this.metricFindQuery = function (query) {
            var interpolated;
            try {
                interpolated = encodeURIComponent(templateSrv.replace(query));
            }
            catch (err) {
                return $q.reject(err);
            }
            if (interpolated == '*') {
              interpolated = '';
            }
            return this.doOpenfalconRequest({ method: 'GET', url: '/metrics/find/?query=' + interpolated })
                .then(function (results) {
                return lodash_1.default.map(results.data, function (metric) {
                    return {
                        text: metric.text,
                        expandable: metric.expandable ? true : false
                    };
                });
            });
        };
        this.testDatasource = function () {
            return this.metricFindQuery('*').then(function () {
                return { status: "success", message: "Data source is working", title: "Success" };
            });
        };
        this.listDashboards = function (query) {
            return this.doOpenfalconRequest({ method: 'GET', url: '/dashboard/find/', params: { query: query || '' } })
                .then(function (results) {
                return results.data.dashboards;
            });
        };
        this.loadDashboard = function (dashName) {
            return this.doOpenfalconRequest({ method: 'GET', url: '/dashboard/load/' + encodeURIComponent(dashName) });
        };
        this.doOpenfalconRequest = function (options) {
            if (this.basicAuth || this.withCredentials) {
                options.withCredentials = true;
            }
            if (this.basicAuth) {
                options.headers = options.headers || {};
                options.headers.Authorization = this.basicAuth;
            }
            options.url = this.url + options.url;
            options.inspect = { type: 'openfalcon' };
            return backendSrv.datasourceRequest(options);
        };
        this._seriesRefLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        this.buildOpenfalconParams = function (options, scopedVars) {
            var openfalcon_options = ['from', 'until', 'rawData', 'format', 'maxDataPoints', 'cacheTimeout'];
            var clean_options = [], targets = {};
            var target, targetValue, i;
            var regex = /\#([A-Z])/g;
            var intervalFormatFixRegex = /'(\d+)m'/gi;
            var hasTargets = false;
            if (options.format !== 'png') {
                options['format'] = 'json';
            }
            function fixIntervalFormat(match) {
                return match.replace('m', 'min').replace('M', 'mon');
            }
            for (i = 0; i < options.targets.length; i++) {
                target = options.targets[i];
                if (!target.target) {
                    continue;
                }
                if (!target.refId) {
                    target.refId = this._seriesRefLetters[i];
                }
                targetValue = templateSrv.replace(target.target, scopedVars);
                targetValue = targetValue.replace(intervalFormatFixRegex, fixIntervalFormat);
                targets[target.refId] = targetValue;
            }
            function nestedSeriesRegexReplacer(match, g1) {
                return targets[g1];
            }
            var target_tmp = [];
            for (i = 0; i < options.targets.length; i++) {
                target = options.targets[i];
                if (!target.target) {
                    continue;
                }
                targetValue = targets[target.refId];
                targetValue = targetValue.replace(regex, nestedSeriesRegexReplacer);
                targets[target.refId] = targetValue;
                if (!target.hide) {
                    hasTargets = true;
                    clean_options.push("target=" + encodeURIComponent(targetValue));
                    target_tmp.push(targetValue);
                }
            }
            lodash_1.default.each(options, function (value, key) {
                if (lodash_1.default.indexOf(openfalcon_options, key) === -1) {
                    return;
                }
                if (value) {
                    clean_options.push(key + "=" + encodeURIComponent(value));
                }
            });
            if (!hasTargets) {
                return [];
            }
            return [clean_options,target_tmp];
        };
    }
    exports_1("OpenfalconDatasource", OpenfalconDatasource);
    return {
        setters:[
            function (lodash_1_1) {
                lodash_1 = lodash_1_1;
            },
            function (dateMath_1) {
                dateMath = dateMath_1;
            }],
        execute: function() {

        }
    }
});
//# sourceMappingURL=datasource.js.map
