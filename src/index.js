'use strict';

var _ = require('underscore'),
    util = require('util'),
    Class = require('class.extend');

module.exports = Class.extend({

   init: function(serverless, opts) {
      this._serverless = serverless;
      this._opts = opts;

      this.hooks = {
         'deploy:compileEvents': this.compileEvents.bind(this),
      };
   },

   compileEvents: function() {
      var self = this;

      _.each(this._serverless.service.functions, function(fnDef, fnName) {
         _.each(fnDef.events, function(evt) {
            if (evt.externalSNS) {
               self.compileEvent(fnName, fnDef, evt.externalSNS);
            }
         });
      });
   },

   compileEvent: function(fnName, fnDef, topicArn) {
      var normalizedFnName = this._normalize(fnName),
          normalizedTopicARN = this._normalizeTopicARN(topicArn),
          fnRef = normalizedFnName + 'LambdaFunction',
          permRef = normalizedFnName + 'LambdaPermission' + normalizedTopicARN,
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

   _normalize: function(s) {
      if (_.isEmpty(s)) {
         return;
      }

      return s[0].toUpperCase() + s.substr(1);
   },

   /**
    * The arn that the user passes in may either be a string or an object if
    * they are using Fn::GetAtt, Ref, or Fn::Join, for example.
    *
    * e.g. 'arn:aws:sns:us-east-1:1234567890:foo-topic', or
    * {
    *    'Fn::Join': [
    *       'arn:aws:sns:us-east-1:',
    *        { Ref: 'AWS::AccountId' },
    *        ':foo-topic',
    *    ]
    * }
    */
   _normalizeTopicARN: function(arn) {
      if (_.isObject(arn) && arn['Fn::Join']) {
         arn = _.reduce(arn['Fn::Join'], function(memo, part) {
            if (_.isObject(part)) {
               if (part.Ref) {
                  part = part.Ref;
               } else {
                  throw new this._serverless.classes.Error(
                     'The externalSNS configuration had an arn using Fn::Join that has an unrecognized object in its parts:' +
                     util.inspect(part)
                  );
               }
            }

            return memo + part;
         }.bind(this), '');
      }

      return this._normalize(arn.replace(/[^0-9A-Za-z]/g, ''));
   },

});
