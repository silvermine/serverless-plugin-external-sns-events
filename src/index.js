'use strict';

var _ = require('underscore'),
    Class = require('class.extend');

module.exports = Class.extend({

   init: function(serverless, opts) {
      this._serverless = serverless;
      this._opts = opts;
      this.provider = serverless ? serverless.getProvider('aws') : null;

      this.hooks = {
         'package:compileEvents': this._loopEvents.bind(this, this.addEventPermission),
         'deploy:deploy': this._loopEvents.bind(this, this.subscribeFunction),
         'before:remove:remove': this._loopEvents.bind(this, this.unsubscribeFunction),
         'subscribeExternalSNS:subscribe': this._loopEvents.bind(this, this.subscribeFunction),
         'unsubscribeExternalSNS:unsubscribe': this._loopEvents.bind(this, this.unsubscribeFunction),
      };

      this.commands = {
         subscribeExternalSNS: {
            usage: 'Adds subscriptions to any SNS Topics defined by externalSNS.',
            lifecycleEvents: [ 'subscribe' ],
         },
         unsubscribeExternalSNS: {
            usage: 'Removes subscriptions from any SNS Topics defined by externalSNS.',
            lifecycleEvents: [ 'unsubscribe' ],
         },
      };

      this._serverless.configSchemaHandler.defineFunctionEvent('aws', 'externalSNS', { type: 'string' });
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
      var fnRef = this.provider.naming.getLambdaLogicalId(fnName),
          permRef = this.provider.naming.getLambdaSnsPermissionLogicalId(fnName, topicName),
          permission;

      permission = {
         Type: 'AWS::Lambda::Permission',
         Properties: {
            FunctionName: { 'Fn::GetAtt': [ fnRef, 'Arn' ] },
            Action: 'lambda:InvokeFunction',
            Principal: 'sns.amazonaws.com',
            SourceArn: {
               'Fn::Join': [
                  ':',
                  [
                     'arn',
                     { 'Ref': 'AWS::Partition' },
                     'sns',
                     { 'Ref': 'AWS::Region' },
                     { 'Ref': 'AWS::AccountId' },
                     topicName,
                  ],
               ],
            },
         },
      };

      this._serverless.service.provider.compiledCloudFormationTemplate.Resources[permRef] = permission;
   },

   subscribeFunction: function(fnName, fnDef, topicName) {
      var self = this;

      if (this._opts.noDeploy) {
         this._serverless.cli.log(
            'Not subscribing ' + fnDef.name + ' to ' + topicName + ' because of the noDeploy flag'
         );
         return;
      }

      this._serverless.cli.log('Need to subscribe ' + fnDef.name + ' to ' + topicName);

      return this._getSubscriptionInfo(fnDef, topicName)
         .then(function(info) {
            var params;

            if (info.SubscriptionArn) {
               self._serverless.cli.log('Function ' + info.FunctionArn + ' is already subscribed to ' + info.TopicArn);
               return;
            }
            params = {
               TopicArn: info.TopicArn,
               Protocol: 'lambda',
               Endpoint: info.FunctionArn,
            };
            return self.provider.request('SNS', 'subscribe', params, self._opts.stage, self._opts.region)
               .then(function() {
                  self._serverless.cli.log('Function ' + info.FunctionArn + ' is now subscribed to ' + info.TopicArn);
                  return;
               });
         });
   },

   unsubscribeFunction: function(fnName, fnDef, topicName) {
      var self = this;

      this._serverless.cli.log('Need to unsubscribe ' + fnDef.name + ' from ' + topicName);

      return this._getSubscriptionInfo(fnDef, topicName)
         .then(function(info) {
            var params = { SubscriptionArn: info.SubscriptionArn };

            if (!info.SubscriptionArn) {
               self._serverless.cli.log('Function ' + info.FunctionArn + ' is not subscribed to ' + info.TopicArn);
               return;
            }

            return self.provider.request('SNS', 'unsubscribe', params, self._opts.stage, self._opts.region)
               .then(function() {
                  self._serverless.cli.log(
                     'Function ' + info.FunctionArn + ' is no longer subscribed to ' + info.TopicArn +
                     ' (deleted ' + info.SubscriptionArn + ')'
                  );
                  return;
               });
         });
   },

   _getSubscriptionInfo: function(fnDef, topicName) {
      var self = this,
          fnArn, acctID, partition, region, topicArn, params;

      params = { FunctionName: fnDef.name };

      return this.provider.request('Lambda', 'getFunction', params, this._opts.stage, this._opts.region)
         .then(function(fn) {
            fnArn = fn.Configuration.FunctionArn;
            // NOTE: assumes that the topic is in the same account and region at this
            // point
            partition = fnArn.split(':')[1];
            region = fnArn.split(':')[3];
            acctID = fnArn.split(':')[4];
            topicArn = 'arn:' + partition + ':sns:' + region + ':' + acctID + ':' + topicName;

            self._serverless.cli.log('Function ARN: ' + fnArn);
            self._serverless.cli.log('Topic ARN: ' + topicArn);

            // NOTE: does not support NextToken and paginating through subscriptions at
            // this point
            return self.provider.request(
               'SNS',
               'listSubscriptionsByTopic',
               { TopicArn: topicArn },
               self._opts.stage,
               self._opts.region
            );
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

});
