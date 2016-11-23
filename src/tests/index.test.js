'use strict';

var expect = require('expect.js'),
    Plugin = require('../index.js'),
    Serverless = require('serverless');

describe('serverless-plugin-external-sns-events', function() {

   describe('addEventPermission', function() {
      var plugin, resources, serverless;

      serverless = new Serverless();
      serverless.service.provider.compiledCloudFormationTemplate = {
         Resources: {},
      };

      plugin = new Plugin(serverless);

      plugin.addEventPermission('someFunction', undefined, 'someTopic');
      resources = serverless.service.provider.compiledCloudFormationTemplate.Resources;

      it('populates Serverless compiledCloudFormationTemplate resources with permission SomeFunctionLambdaPermissionSomeTopic', function() {
         expect(resources).to.only.have.key('SomeFunctionLambdaPermissionSomeTopic');
      });

      it('populates permission object with SourceArn', function() {
         expect(resources.SomeFunctionLambdaPermissionSomeTopic.Properties).to.have.key('SourceArn');
      });
   });


   describe('_normalize', function() {
      var plugin = new Plugin();

      it('returns undefined for empty strings', function() {
         expect(plugin._normalize('')).to.be(undefined);
         expect(plugin._normalize(false)).to.be(undefined);
         expect(plugin._normalize()).to.be(undefined);
         expect(plugin._normalize('', true)).to.be(undefined);
         expect(plugin._normalize(false, true)).to.be(undefined);
         expect(plugin._normalize(undefined, true)).to.be(undefined);
      });

      it('only modifies the first letter', function() {
         expect(plugin._normalize('someTHING')).to.eql('SomeTHING');
         expect(plugin._normalize('SomeTHING')).to.eql('SomeTHING');
         expect(plugin._normalize('s')).to.eql('S');
         expect(plugin._normalize('S')).to.eql('S');
      });

   });


   describe('_normalizeTopicName', function() {
      var plugin = new Plugin();

      it('produces expected output for a string', function() {
         expect(plugin._normalizeTopicName('foo-topic')).to
            .eql('Footopic');
      });

   });

});
