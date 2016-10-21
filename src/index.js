'use strict';

var _ = require('underscore'),
    Q = require('q'),
    AWS = require('aws-sdk'),
    Class = require('class.extend');

module.exports = Class.extend({

   init: function(serverless, opts) {
      this._serverless = serverless;
      this._opts = opts;

      this.hooks = {
         'deploy:compileEvents': this._loopEvents.bind(this, this.addEventPermission),
         'deploy:deploy': this._loopEvents.bind(this, this.subscribeFunction),
         'before:remove:remove': this._loopEvents.bind(this, this.unsubscribeFunction),
         'subscribeExternalSNS:subscribe': this._loopEvents.bind(this, this.subscribeFunction),
         'unsubscribeExternalSNS:unsubscribe': this._loopEvents.bind(this, this.unsubscribeFunction),
      };

      this.commands = {
         subscribeExternalSNS: {
            lifecycleEvents: [ 'subscribe' ],
         },
         unsubscribeExternalSNS: {
            lifecycleEvents: [ 'unsubscribe' ],
         },
      };
   },

   _loopEvents: function(fn) {
      var self = this;

      _.each(this._serverless.service.functions, function(fnDef, fnName) {
         _.each(fnDef.events, function(evt) {
            if (evt.externalSNS) {
               fn.call(self, fnName, fnDef, evt.externalSNS);
            }
         });
      });
   },

   addEventPermission: function(fnName, fnDef, topicName) {
      var normalizedFnName = this._normalize(fnName),
          normalizedTopicName = this._normalizeTopicName(topicName),
          fnRef = normalizedFnName + 'LambdaFunction',
          permRef = normalizedFnName + 'LambdaPermission' + normalizedTopicName,
          permission;

      permission = {
         Type: 'AWS::Lambda::Permission',
         Properties: {
            FunctionName: { 'Fn::GetAtt': [ fnRef, 'Arn' ] },
            Action: 'lambda:InvokeFunction',
            Principal: 'sns.amazonaws.com',
         },
      };

      this._serverless.service.provider.compiledCloudFormationTemplate.Resources[permRef] = permission;
   },

   subscribeFunction: function(fnName, fnDef, topicName) {
      var self = this,
          sns_region,
          sns;

      if (this._opts.noDeploy) {
         return this._serverless.cli.log(
            'Not subscribing ' + fnDef.name + ' to ' + topicName + ' because of the noDeploy flag'
         );
      }

      this._serverless.cli.log('Need to subscribe ' + fnDef.name + ' to ' + topicName);

      return this._getSubscriptionInfo(fnName, fnDef, topicName)
         .then(function(info) {
            if (info.SubscriptionArn) {
               return self._serverless.cli.log('Function ' + info.FunctionArn + ' is already subscribed to ' + info.TopicArn);
            }
            sns_region = info.TopicArn.split(':')[3];
            sns = new AWS.SNS({region: sns_region});

            return Q.ninvoke(sns, 'subscribe', { TopicArn: info.TopicArn, Protocol: 'lambda', Endpoint: info.FunctionArn })
               .then(function() {
                  return self._serverless.cli.log('Function ' + info.FunctionArn + ' is now subscribed to ' + info.TopicArn);
               });
         });
   },

   unsubscribeFunction: function(fnName, fnDef, topicName) {
      var self = this,
          sns_region,
          sns;

      this._serverless.cli.log('Need to unsubscribe ' + fnDef.name + ' from ' + topicName);

      return this._getSubscriptionInfo(fnName, fnDef, topicName)
         .then(function(info) {
            if (!info.SubscriptionArn) {
               return self._serverless.cli.log('Function ' + info.FunctionArn + ' is not subscribed to ' + info.TopicArn);
            }
            sns_region = info.TopicArn.split(':')[3];
            sns = new AWS.SNS({region: sns_region});

            return Q.ninvoke(sns, 'unsubscribe', { SubscriptionArn: info.SubscriptionArn })
               .then(function() {
                  return self._serverless.cli.log(
                     'Function ' + info.FunctionArn + ' is no longer subscribed to ' + info.TopicArn +
                     ' (deleted ' + info.SubscriptionArn + ')'
                  );
               });
         });
   },

   _getSubscriptionInfo: function(fnName, fnDef, topicName) {
      var self = this,
          sns,
          lambda = new AWS.Lambda(),
          fnArn, acctID, region, topicArn;

      return Q.ninvoke(lambda, 'getFunction', { FunctionName: fnDef.name })
         .then(function(fn) {
            fnArn = fn.Configuration.FunctionArn;
            if (topicName.startsWith('arn:aws')) {
                topicArn = topicName;
                region = topicArn.split(':')[3];
                sns = new AWS.SNS({region: region});
                return Q.ninvoke(sns, 'listSubscriptions');
            } else {
                // NOTE: assumes that the topic is in the same account and region at this point
                region = fnArn.split(':')[3];
                acctID = fnArn.split(':')[4];
                topicArn = 'arn:aws:sns:' + region + ':' + acctID + ':' + topicName;
                self._serverless.cli.log('Function ARN: ' + fnArn);
                self._serverless.cli.log('Topic ARN: ' + topicArn);

                // NOTE: does not support NextToken and paginating through subscriptions at this point
                sns = new AWS.SNS()
                return Q.ninvoke(sns, 'listSubscriptionsByTopic', { TopicArn: topicArn });
            }
         })
         .then(function(resp) {
            var existing = _.findWhere(resp.Subscriptions, { Protocol: 'lambda', Endpoint: fnArn }) || {};

            return {
               FunctionArn: fnArn,
               TopicArn: topicArn,
               SubscriptionArn: existing.SubscriptionArn,
            };
         });
   },

   _normalize: function(s) {
      if (_.isEmpty(s)) {
         return;
      }

      return s[0].toUpperCase() + s.substr(1);
   },

   _normalizeTopicName: function(arn) {
      return this._normalize(arn.replace(/[^0-9A-Za-z]/g, ''));
   },

});
